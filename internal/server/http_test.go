package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/maintainer64/gwent-classic/internal/game"
)

func client(t *testing.T) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return &http.Client{Jar: jar}
}
func post(t *testing.T, c *http.Client, url string, v any) (int, map[string]any) {
	t.Helper()
	raw, _ := json.Marshal(v)
	req, _ := http.NewRequest("POST", url, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, body
}
func get(t *testing.T, c *http.Client, url string) (int, map[string]any) {
	t.Helper()
	resp, err := c.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, body
}

func TestAPIRateLimitStaysSharedAcrossPlayersOnSameIP(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	handler := NewAPI(store, fixture(), t.TempDir()).Handler()
	for i := 0; i <= 180; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/unknown", nil)
		req.RemoteAddr = "192.0.2.1:1234"
		req.AddCookie(&http.Cookie{Name: cookieName, Value: strings.Repeat(string('a'+rune(i%2)), 64)})
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		want := http.StatusNotFound
		if i == 180 {
			want = http.StatusTooManyRequests
		}
		if response.Code != want {
			t.Fatalf("request %d: got %d, want %d", i+1, response.Code, want)
		}
	}
	other := httptest.NewRequest(http.MethodGet, "/api/unknown", nil)
	other.RemoteAddr = "192.0.2.2:1234"
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, other)
	if response.Code != http.StatusNotFound {
		t.Fatalf("another IP was blocked: %d", response.Code)
	}
}

func TestAnonymousTwoPlayerMatchPersistenceAndTTL(t *testing.T) {
	dir := t.TempDir()
	store, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	api := NewAPI(store, fixture(), t.TempDir())
	ts := httptest.NewServer(api.Handler())
	defer ts.Close()
	alice, bob, stranger := client(t), client(t), client(t)
	status, created := post(t, alice, ts.URL+"/api/rooms", map[string]any{"name": "Alice", "mode": "pvp", "faction": "realms"})
	if status != 201 {
		t.Fatalf("create: %d %+v", status, created)
	}
	code := created["code"].(string)
	base := ts.URL + "/api/rooms/" + code
	if status, _ := get(t, stranger, base); status != 403 {
		t.Fatalf("outsider read allowed: %d", status)
	}
	status, joined := post(t, bob, base+"/join", map[string]any{"name": "Bob", "faction": "monsters", "expectedVersion": 0})
	if status != 200 {
		t.Fatalf("join: %d %+v", status, joined)
	}
	players := joined["players"].([]any)
	if len(players) != 2 {
		t.Fatal("missing player")
	}
	if _, ok := players[0].(map[string]any)["hand"]; ok {
		t.Fatal("opponent hand leaked")
	}
	if status, _ := post(t, stranger, base+"/join", map[string]any{"name": "X", "faction": "realms", "expectedVersion": 1}); status == 200 {
		t.Fatal("third player joined")
	}
	if status, _ := post(t, alice, base+"/actions", map[string]any{"expectedVersion": 0, "action": map[string]any{"type": "pass"}}); status != 409 {
		t.Fatalf("stale write allowed: %d", status)
	}
	// Another Store instance sees persisted state without sharing memory.
	loaded, err := func() (*game.Room, error) {
		other, e := NewStore(dir)
		if e != nil {
			return nil, e
		}
		return other.Load(code)
	}()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Status != "playing" || loaded.ExpiresAt.Sub(loaded.CreatedAt) != 24*time.Hour {
		t.Fatal("restart didn't preserve room")
	}
	store.SetClock(func() time.Time { return loaded.ExpiresAt.Add(time.Nanosecond) })
	if status, _ := get(t, alice, base); status != 410 {
		t.Fatalf("expired room still readable: %d", status)
	}
	if status, _ := get(t, bob, base); status != 404 {
		t.Fatalf("expired room still exists: %d", status)
	}
}
func TestOriginAndJSONGuards(t *testing.T) {
	store, _ := NewStore(t.TempDir())
	ts := httptest.NewServer(NewAPI(store, fixture(), t.TempDir()).Handler())
	defer ts.Close()
	c := client(t)
	req, _ := http.NewRequest("POST", ts.URL+"/api/rooms", strings.NewReader(`{"name":"Alice","mode":"bot","faction":"realms"}`))
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatalf("cross-site request: %d", resp.StatusCode)
	}
}

func fixture() game.Catalog {
	var cards game.Catalog
	for _, faction := range game.Factions {
		cards = append(cards, game.Definition{Name: "Leader", Deck: faction, Row: "leader", Count: "1"})
		for i := 0; i < 28; i++ {
			row := []string{"close", "ranged", "siege"}[i%3]
			cards = append(cards, game.Definition{Name: "Infantry", Deck: faction, Row: row, Strength: "5", Count: "1"})
		}
	}
	return cards
}

func TestSpaDeepLink(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>gwent multiplayer</html>"), 0600); err != nil {
		t.Fatal(err)
	}
	store, _ := NewStore(t.TempDir())
	api := NewAPI(store, fixture(), dir)
	req := httptest.NewRequest("GET", "http://localhost/room/ABCDEFGHJKLM", nil)
	w := httptest.NewRecorder()
	api.Handler().ServeHTTP(w, req)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "gwent multiplayer") {
		t.Fatalf("deep link failed: %d %s", w.Code, w.Body.String())
	}
}

func TestRoomListIsPerBrowser(t *testing.T) {
	store, _ := NewStore(t.TempDir())
	ts := httptest.NewServer(NewAPI(store, fixture(), t.TempDir()).Handler())
	defer ts.Close()
	alice, bob := client(t), client(t)
	status, created := post(t, alice, ts.URL+"/api/rooms", map[string]any{"name": "Alice", "mode": "pvp", "faction": "realms"})
	if status != 201 {
		t.Fatal(created)
	}
	status, listed := get(t, alice, ts.URL+"/api/rooms")
	if status != 200 || len(listed["rooms"].([]any)) != 1 {
		t.Fatalf("owner cannot list room: %+v", listed)
	}
	status, listed = get(t, bob, ts.URL+"/api/rooms")
	if status != 200 || len(listed["rooms"].([]any)) != 0 {
		t.Fatalf("foreign rooms leaked: %+v", listed)
	}
}

func TestAPIConfiguredBotCustomDeck(t *testing.T) {
	c := fixture()
	store, _ := NewStore(t.TempDir())
	ts := httptest.NewServer(NewAPI(store, c, t.TempDir()).Handler())
	defer ts.Close()
	alice := client(t)
	code, cat := get(t, alice, ts.URL+"/api/catalog")
	if code != 200 || len(cat["cards"].([]any)) < 22 {
		t.Fatalf("missing public card catalog: %+v", cat)
	}
	deck := []map[string]int{}
	for i, d := range c {
		if d.Deck == "skellige" && d.Row != "leader" {
			deck = append(deck, map[string]int{"def": i, "count": 1})
			if len(deck) == 22 {
				break
			}
		}
	}
	options := map[string]any{"difficulty": "hard", "deckMode": "custom", "faction": "skellige", "deck": deck}
	status, res := post(t, alice, ts.URL+"/api/rooms", map[string]any{"name": "Alice", "mode": "bot", "faction": "realms", "bot": options})
	if status != 201 {
		t.Fatalf("custom room: %d %+v", status, res)
	}
	bot := res["bot"].(map[string]any)
	if bot["difficulty"] != "hard" || bot["faction"] != "skellige" {
		t.Fatalf("wrong bot settings: %+v", bot)
	}
	if _, ok := bot["deck"]; ok {
		t.Fatal("custom deck leaked into projected settings")
	}
	players := res["players"].([]any)
	if _, ok := players[1].(map[string]any)["hand"]; ok {
		t.Fatal("opponent hand leaked")
	}
	status, res = post(t, alice, ts.URL+"/api/rooms", map[string]any{"name": "Alice", "mode": "bot", "faction": "realms", "bot": map[string]any{"difficulty": "hard", "deckMode": "custom", "faction": "skellige", "deck": deck[:21]}})
	if status != 400 {
		t.Fatalf("invalid deck allowed: %d %+v", status, res)
	}
	status, res = post(t, alice, ts.URL+"/api/rooms", map[string]any{"name": "Alice", "mode": "pvp", "faction": "realms", "bot": options})
	if status != 400 {
		t.Fatalf("bot settings allowed in PvP: %d %+v", status, res)
	}
}
