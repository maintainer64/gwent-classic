package server

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/maintainer64/gwent-classic/internal/game"
)

const cookieName = "gwent_player"
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

var tokenRE = regexp.MustCompile(`^[0-9a-f]{64}$`)
var apiRoute = regexp.MustCompile(`^/api/rooms/([A-Z2-9]{12})(?:/(join|prepare|actions|ws))?$`)

type limit struct {
	hits    int
	expires time.Time
}
type API struct {
	Catalog      game.Catalog
	Store        *Store
	Hub          *Hub
	Static       http.Handler
	IndexPath    string
	SecureCookie bool
	PublicOrigin string
	rates        map[string]limit
	rateMu       sync.Mutex
}

func NewAPI(store *Store, catalog game.Catalog, staticDir string) *API {
	store.SetCatalog(catalog)
	return &API{Store: store, Catalog: catalog, Hub: NewHub(store, catalog), Static: http.FileServer(http.Dir(staticDir)), IndexPath: filepath.Join(staticDir, "index.html"), rates: map[string]limit{}}
}
func (a *API) rate(key string, n int) bool {
	a.rateMu.Lock()
	defer a.rateMu.Unlock()
	now := time.Now()
	bucket := a.rates[key]
	if now.After(bucket.expires) {
		bucket = limit{expires: now.Add(time.Minute)}
	}
	bucket.hits++
	a.rates[key] = bucket
	if len(a.rates) > 5000 {
		for k, v := range a.rates {
			if now.After(v.expires) {
				delete(a.rates, k)
			}
		}
	}
	return bucket.hits <= n
}
func token(w http.ResponseWriter, r *http.Request, secure bool) string {
	var value string
	if cookies := r.Cookies(); len(cookies) > 0 {
		for _, c := range cookies {
			if c.Name == cookieName && tokenRE.MatchString(c.Value) {
				value = c.Value
				break
			}
		}
	}
	if value == "" {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			panic(err)
		}
		value = hex.EncodeToString(b)
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: value, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secure, Path: "/", MaxAge: 86400})
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}
func makeCode() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}
func respond(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
func fail(w http.ResponseWriter, status int, msg string) {
	respond(w, status, map[string]string{"error": msg, "code": errorCode(status, msg)})
}
func jsonBody(w http.ResponseWriter, r *http.Request, v any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, 415, "Expected application/json")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 32768)
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		fail(w, 400, "Invalid JSON request")
		return false
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		fail(w, 400, "Only one JSON object is allowed")
		return false
	}
	return true
}
func validateName(s string) bool {
	return utf8.ValidString(s) && len(strings.TrimSpace(s)) > 0 && utf8.RuneCountInString(s) <= 24
}
func (a *API) writeOriginOK(r *http.Request) bool {
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		return false
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	expected := a.PublicOrigin
	if expected == "" {
		scheme := "http"
		if r.TLS != nil || a.SecureCookie {
			scheme = "https"
		}
		expected = scheme + "://" + r.Host
	}
	return origin == expected
}
func remoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}
func (a *API) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' https://www.youtube.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
		if r.URL.Path == "/healthz" {
			if r.Method != http.MethodGet {
				fail(w, 405, "Method not allowed")
				return
			}
			respond(w, 200, map[string]string{"status": "ok"})
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			if !a.rate("api:"+remoteIP(r), 180) {
				fail(w, 429, "Too many requests")
				return
			}
			if r.Method == http.MethodPost && !a.writeOriginOK(r) {
				fail(w, 403, "Cross-origin writes forbidden")
				return
			}
			user := token(w, r, a.SecureCookie)
			if r.URL.Path == "/api/catalog" && r.Method == http.MethodGet {
				respond(w, 200, map[string]any{"leaders": game.LeaderOptions(a.Catalog), "cards": game.DeckCatalog(a.Catalog), "factions": game.Factions})
				return
			}
			if r.URL.Path == "/api/rooms" && r.Method == http.MethodGet {
				summaries, err := a.Store.List(user)
				if err != nil {
					fail(w, 500, "Could not list rooms")
					return
				}
				respond(w, 200, map[string]any{"rooms": summaries})
				return
			}
			if r.URL.Path == "/api/rooms" && r.Method == http.MethodPost {
				if !a.rate("create:"+remoteIP(r), 12) {
					fail(w, 429, "Too many rooms")
					return
				}
				var in struct {
					Name    string           `json:"name"`
					Faction string           `json:"faction"`
					Mode    string           `json:"mode"`
					Leader  int              `json:"leader"`
					Deck    []game.DeckEntry `json:"deck,omitempty"`
					Bot     *game.BotOptions `json:"bot,omitempty"`
					Timer   *game.TurnTimer  `json:"timer,omitempty"`
					Lobby   bool             `json:"lobby,omitempty"`
				}
				if !jsonBody(w, r, &in) {
					return
				}
				if !validateName(in.Name) {
					fail(w, 400, "Name must be 1-24 characters")
					return
				}
				if in.Mode != "bot" && in.Bot != nil {
					fail(w, 400, "bot settings are only available in bot mode")
					return
				}
				if in.Lobby && in.Mode != "pvp" {
					fail(w, 400, "invalid mode for lobby")
					return
				}
				timer, err := game.NormalizeTimer(in.Timer)
				if err != nil {
					fail(w, 400, err.Error())
					return
				}
				bot := game.BotOptions{}
				if in.Bot != nil {
					bot = *in.Bot
				}
				for i := 0; i < 6; i++ {
					room, err := game.NewRoomWithDeck(makeCode(), in.Mode, user, strings.TrimSpace(in.Name), in.Faction, a.Catalog, time.Now(), 0, bot, in.Deck, in.Leader)
					if err != nil {
						fail(w, 400, err.Error())
						return
					}
					room.Timer = &timer
					room.Lobby = in.Lobby
					if err := a.Store.Create(room); err == nil {
						a.Hub.Broadcast(room.Code, room)
						respond(w, 201, room.Project(0, a.Catalog))
						return
					}
				}
				fail(w, 503, "Cannot create room")
				return
			}
			match := apiRoute.FindStringSubmatch(r.URL.Path)
			if match == nil {
				fail(w, 404, "Unknown API route")
				return
			}
			code, suffix := match[1], match[2]
			// WebSocket upgrades: canonical /api/rooms/CODE/ws, plus the bare
			// room path when an Upgrade header is present (both are one hop).
			wsRequested := suffix == "ws" || (suffix == "" && strings.EqualFold(r.Header.Get("Upgrade"), "websocket"))
			if wsRequested && r.Method == http.MethodGet {
				if !a.rate("ws:"+remoteIP(r), 12) {
					fail(w, 429, "Too many connections")
					return
				}
				if !a.writeOriginOK(r) {
					fail(w, 403, "Cross-origin connections forbidden")
					return
				}
				if !wsHandshakeOK(r) {
					fail(w, 400, "Invalid WebSocket upgrade")
					return
				}
				a.serveWS(w, r, code, user)
				return
			}
			if suffix == "ws" {
				fail(w, 405, "WebSocket upgrade only")
				return
			}
			if suffix == "" && r.Method == http.MethodGet {
				room, err := a.Store.Load(code)
				if err != nil {
					storeError(w, err)
					return
				}
				seat := room.IndexFor(user)
				if seat < 0 {
					fail(w, 403, "Join to see this room")
					return
				}
				respond(w, 200, room.Project(seat, a.Catalog))
				return
			}
			if r.Method != http.MethodPost {
				fail(w, 405, "Method not allowed")
				return
			}
			if !a.rate("write:"+user, 100) {
				fail(w, 429, "Too many actions")
				return
			}
			switch suffix {
			case "join":
				var in struct {
					Name            string           `json:"name"`
					Faction         string           `json:"faction"`
					Leader          int              `json:"leader"`
					ExpectedVersion int              `json:"expectedVersion"`
					Deck            []game.DeckEntry `json:"deck,omitempty"`
				}
				if !jsonBody(w, r, &in) {
					return
				}
				if !validateName(in.Name) {
					fail(w, 400, "Name must be 1-24 characters")
					return
				}
				join := func(room *game.Room) error {
					if room.IndexFor(user) >= 0 {
						return errors.New("already joined")
					}
					return room.JoinWithDeck(user, strings.TrimSpace(in.Name), in.Faction, a.Catalog, in.Deck, in.Leader)
				}
				room, err := a.Store.Change(code, in.ExpectedVersion, join)
				// The host may have finalized setup after the guest opened the
				// invitation. Seat capacity is still checked under the store lock.
				if err != nil && err.Error() == "stale room version" {
					if latest, loadErr := a.Store.Load(code); loadErr == nil {
						room, err = a.Store.Change(code, latest.Version, join)
					}
				}
				if err != nil {
					storeError(w, err)
					return
				}
				respond(w, 200, room.Project(1, a.Catalog))
				a.Hub.Broadcast(code, room)
			case "prepare":
				var in struct {
					Name            string           `json:"name"`
					Faction         string           `json:"faction"`
					Leader          int              `json:"leader"`
					Deck            []game.DeckEntry `json:"deck,omitempty"`
					Timer           *game.TurnTimer  `json:"timer,omitempty"`
					ExpectedVersion int              `json:"expectedVersion"`
				}
				if !jsonBody(w, r, &in) {
					return
				}
				if !validateName(in.Name) {
					fail(w, 400, "Name must be 1-24 characters")
					return
				}
				room, err := a.Store.Change(code, in.ExpectedVersion, func(room *game.Room) error {
					return room.PrepareLobby(room.IndexFor(user), strings.TrimSpace(in.Name), in.Faction, in.Leader, in.Deck, in.Timer, a.Catalog)
				})
				if err != nil {
					storeError(w, err)
					return
				}
				respond(w, 200, room.Project(0, a.Catalog))
				a.Hub.Broadcast(code, room)
			case "actions":
				var in struct {
					ExpectedVersion int         `json:"expectedVersion"`
					Action          game.Action `json:"action"`
				}
				if !jsonBody(w, r, &in) {
					return
				}
				room, err := a.Store.Change(code, in.ExpectedVersion, func(room *game.Room) error {
					seat := room.IndexFor(user)
					if seat < 0 {
						return errors.New("not a player")
					}
					return room.Apply(seat, in.Action, a.Catalog)
				})
				if err != nil {
					storeError(w, err)
					return
				}
				respond(w, 200, room.Project(room.IndexFor(user), a.Catalog))
				a.Hub.Broadcast(code, room)
			default:
				fail(w, 404, "Unknown API route")
			}
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			fail(w, 405, "Method not allowed")
			return
		}
		if strings.HasPrefix(r.URL.Path, "/img/") {
			a.Static.ServeHTTP(w, r)
			return
		}
		if r.URL.Path == "/" || strings.HasPrefix(r.URL.Path, "/room/") {
			http.ServeFile(w, r, a.IndexPath)
			return
		}
		a.Static.ServeHTTP(w, r)
	})
}
func storeError(w http.ResponseWriter, err error) {
	status := 400
	switch {
	case errors.Is(err, ErrMissing):
		status = 404
	case errors.Is(err, ErrExpired):
		status = 410
	case strings.Contains(err.Error(), "stale room version"):
		status = 409
	case strings.Contains(err.Error(), "already") || strings.Contains(err.Error(), "not your turn") || strings.Contains(err.Error(), "not accepting"):
		status = 409
	case strings.Contains(err.Error(), "not a player"):
		status = 403
	}
	fail(w, status, err.Error())
}
func (a *API) Serve(addr string) error {
	server := &http.Server{Addr: addr, Handler: a.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 8192}
	log.Printf("Gwent server on %s", addr)
	return server.ListenAndServe()
}
func (a *API) Trace() string { return fmt.Sprintf("cards=%d", len(a.Catalog)) }
func ReadCards(path string) (game.Catalog, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return game.ParseLegacyCards(data)
}
