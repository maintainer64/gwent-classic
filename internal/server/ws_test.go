package server

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/maintainer64/gwent-classic/internal/game"
	"time"
)

// readServerFrame parses an unmasked server-to-client frame in tests.
func readServerFrame(br *bufio.Reader) (byte, []byte, error) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(br, header); err != nil {
		return 0, nil, err
	}
	opcode := header[0] & 0x0f
	length := int64(header[1] & 0x7f)
	switch length {
	case 126:
		var ext [2]byte
		if _, err := io.ReadFull(br, ext[:]); err != nil {
			return 0, nil, err
		}
		length = int64(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		if _, err := io.ReadFull(br, ext[:]); err != nil {
			return 0, nil, err
		}
		length = int64(binary.BigEndian.Uint64(ext[:]))
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(br, payload); err != nil {
		return 0, nil, err
	}
	return opcode, payload, nil
}

// writeClientFrame sends a masked frame the way browsers do.
func writeClientFrame(conn net.Conn, opcode byte, payload []byte) error {
	var head bytes.Buffer
	head.WriteByte(0x80 | opcode)
	switch n := len(payload); {
	case n < 126:
		head.WriteByte(0x80 | byte(n))
	case n <= 0xffff:
		head.WriteByte(0x80 | 126)
		var ext [2]byte
		binary.BigEndian.PutUint16(ext[:], uint16(n))
		head.Write(ext[:])
	default:
		head.WriteByte(0x80 | 127)
		var ext [8]byte
		binary.BigEndian.PutUint64(ext[:], uint64(n))
		head.Write(ext[:])
	}
	mask := [4]byte{0x12, 0x34, 0x56, 0x78}
	head.Write(mask[:])
	masked := make([]byte, len(payload))
	for i := range payload {
		masked[i] = payload[i] ^ mask[i%4]
	}
	head.Write(masked)
	_, err := conn.Write(head.Bytes())
	return err
}

// wsDial performs the client half of the RFC 6455 handshake over raw TCP.
func wsDial(t *testing.T, serverURL, cookieValue string) (net.Conn, *bufio.Reader) {
	t.Helper()
	return wsDialStatus(t, serverURL, cookieValue, http.StatusSwitchingProtocols)
}

func wsDialStatus(t *testing.T, serverURL, cookieValue string, wantStatus int) (net.Conn, *bufio.Reader) {
	t.Helper()
	u, err := url.Parse(serverURL)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := net.Dial("tcp", u.Host)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef"))
	request := "GET " + u.Path + " HTTP/1.1\r\n" +
		"Host: " + u.Host + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Version: 13\r\n" +
		"Sec-WebSocket-Key: " + key + "\r\n" +
		"Cookie: " + cookieName + "=" + cookieValue + "\r\n\r\n"
	if _, err := conn.Write([]byte(request)); err != nil {
		t.Fatal(err)
	}
	br := bufio.NewReader(conn)
	status, err := br.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	var accept string
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if line == "\r\n" {
			break
		}
		if strings.HasPrefix(line, "Sec-WebSocket-Accept:") {
			accept = strings.TrimSpace(strings.TrimPrefix(line, "Sec-WebSocket-Accept:"))
		}
	}
	if !strings.HasPrefix(status, fmt.Sprintf("HTTP/1.1 %d ", wantStatus)) {
		t.Fatalf("expected %d, got %q", wantStatus, strings.TrimSpace(status))
	}
	if want := wsAcceptKey(key); wantStatus == http.StatusSwitchingProtocols && accept != want {
		t.Fatalf("bad accept key: got %q want %q", accept, want)
	}
	_ = conn.SetDeadline(time.Time{})
	return conn, br
}

func TestWebSocketReconnectLimitDoesNotBlockOtherPlayersOnSameIP(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	api := NewAPI(store, fixture(), t.TempDir())
	srv := httptest.NewServer(api.Handler())
	defer srv.Close()
	paths := make([]string, 2)
	cookies := make([]string, 2)
	for i := range paths {
		player := client(t)
		status, room := post(t, player, srv.URL+"/api/rooms", map[string]any{"name": "Player", "mode": "bot", "faction": "realms"})
		if status != http.StatusCreated {
			t.Fatalf("create: %d %+v", status, room)
		}
		paths[i] = srv.URL + "/api/rooms/" + room["code"].(string)
		cookies[i] = player.Jar.Cookies(mustURL(t, srv.URL))[0].Value
	}
	for i := 0; i < 12; i++ {
		path := paths[0]
		if i%2 == 0 {
			path += "/ws"
		}
		conn, _ := wsDial(t, path, cookies[0])
		_ = conn.Close()
	}
	// Both upgrade routes share the same player's reconnect budget.
	for _, suffix := range []string{"/ws", ""} {
		conn, _ := wsDialStatus(t, paths[0]+suffix, cookies[0], http.StatusTooManyRequests)
		_ = conn.Close()
	}
	// A second browser behind the same router still receives its live state.
	conn, reader := wsDial(t, paths[1]+"/ws", cookies[1])
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, payload, err := readServerFrame(reader)
	if err != nil {
		t.Fatal(err)
	}
	var view game.View
	if err := json.Unmarshal(payload, &view); err != nil {
		t.Fatal(err)
	}
	if view.Code != strings.TrimPrefix(paths[1], srv.URL+"/api/rooms/") {
		t.Fatal("second player did not receive their room")
	}
}

func TestWebSocketFrames(t *testing.T) {
	// Client masked roundtrip through the real readFrame implementation.
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	go func() {
		_ = writeClientFrame(client, 0x1, []byte("sync"))
	}()
	opcode, payload, err := readFrame(bufio.NewReader(server))
	if err != nil {
		t.Fatal(err)
	}
	if opcode != 0x1 || string(payload) != "sync" {
		t.Fatalf("unexpected frame: op=%x payload=%q", opcode, payload)
	}
	// Unmasked client frames are rejected.
	raw := []byte{0x81, 0x02, 'h', 'i'}
	if _, _, err := readFrame(bufio.NewReader(bytes.NewReader(raw))); err == nil {
		t.Fatal("unmasked client frame accepted")
	}
	// Oversized frames are rejected before allocating.
	big := []byte{0x81, 0x80 | 127, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 0}
	if _, _, err := readFrame(bufio.NewReader(bytes.NewReader(big))); err == nil {
		t.Fatal("oversized frame accepted")
	}
	// Server frames use the correct length encodings.
	var buf bytes.Buffer
	if err := writeFrame(bufio.NewWriter(&buf), 0x1, bytes.Repeat([]byte("x"), 300)); err != nil {
		t.Fatal(err)
	}
	opcode, payload, err = readServerFrame(bufio.NewReader(&buf))
	if err != nil || opcode != 0x1 || len(payload) != 300 {
		t.Fatalf("server frame roundtrip failed: op=%x len=%d err=%v", opcode, len(payload), err)
	}
}

func TestWebSocketPushAndSync(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	api := NewAPI(store, fixture(), t.TempDir())
	ts := httptest.NewServer(api.Handler())
	defer ts.Close()
	jar, _ := cookiejar.New(nil)
	httpClient := &http.Client{Jar: jar}
	raw, _ := json.Marshal(map[string]any{"name": "Alice", "mode": "bot", "faction": "realms"})
	resp, err := httpClient.Post(ts.URL+"/api/rooms", "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	var created map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 201 {
		t.Fatalf("create: %d %+v", resp.StatusCode, created)
	}
	code := created["code"].(string)
	cookieValue := jar.Cookies(mustURL(t, ts.URL))[0].Value
	conn, br := wsDial(t, ts.URL+"/api/rooms/"+code+"/ws", cookieValue)
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	// Initial snapshot on connect.
	opcode, payload, err := readServerFrame(br)
	if err != nil {
		t.Fatal(err)
	}
	if opcode != 0x1 {
		t.Fatalf("expected text snapshot, got op=%x", opcode)
	}
	var view map[string]any
	if err := json.Unmarshal(payload, &view); err != nil {
		t.Fatal(err)
	}
	if view["code"] != code {
		t.Fatalf("snapshot for wrong room: %+v", view)
	}
	// A "sync" request triggers a fresh snapshot.
	if err := writeClientFrame(conn, 0x1, []byte("sync")); err != nil {
		t.Fatal(err)
	}
	if _, payload, err = readServerFrame(br); err != nil {
		t.Fatal(err)
	}
	// The room is in the mulligan phase; finishing the redraw is a legal
	// move that bumps the version.
	before := int64(view["version"].(float64))
	action, _ := json.Marshal(map[string]any{"expectedVersion": created["version"], "action": map[string]any{"type": "ready"}})
	req, _ := http.NewRequest("POST", ts.URL+"/api/rooms/"+code+"/actions", bytes.NewReader(action))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: cookieName, Value: cookieValue})
	pushed, err := httpClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	pushed.Body.Close()
	if pushed.StatusCode != 200 {
		t.Fatalf("action over HTTP failed: %d", pushed.StatusCode)
	}
	// The open socket receives the new version without any polling.
	for {
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		_, payload, err = readServerFrame(br)
		if err != nil {
			t.Fatal(err)
		}
		var update map[string]any
		if err := json.Unmarshal(payload, &update); err != nil {
			t.Fatal(err)
		}
		if version, _ := update["version"].(float64); int64(version) > before {
			break
		}
	}
}

func TestWebSocketRejectsOutsiderAndBadHandshake(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	api := NewAPI(store, fixture(), t.TempDir())
	ts := httptest.NewServer(api.Handler())
	defer ts.Close()
	jar, _ := cookiejar.New(nil)
	httpClient := &http.Client{Jar: jar}
	raw, _ := json.Marshal(map[string]any{"name": "Alice", "mode": "pvp", "faction": "realms"})
	resp, err := httpClient.Post(ts.URL+"/api/rooms", "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	var created map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()
	code := created["code"].(string)
	// A visitor without the owner cookie cannot upgrade.
	stranger := "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
	u, _ := url.Parse(ts.URL)
	conn, err := net.Dial("tcp", u.Host)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	request := fmt.Sprintf("GET /api/rooms/%s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: %s\r\nCookie: %s=%s\r\n\r\n",
		code, u.Host, base64.StdEncoding.EncodeToString([]byte("0123456789abcdef")), cookieName, stranger)
	if _, err := conn.Write([]byte(request)); err != nil {
		t.Fatal(err)
	}
	line, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(line, "403") {
		t.Fatalf("outsider upgrade allowed: %q", strings.TrimSpace(line))
	}
	// A plain GET over HTTP still works for an authenticated member.
	member, err := httpClient.Get(ts.URL + "/api/rooms/" + code)
	if err != nil {
		t.Fatal(err)
	}
	member.Body.Close()
	if member.StatusCode != 200 {
		t.Fatalf("member plain GET must serve the snapshot, got %d", member.StatusCode)
	}
	// An anonymous GET is refused, upgrade or not.
	anon, err := http.Get(ts.URL + "/api/rooms/" + code)
	if err != nil {
		t.Fatal(err)
	}
	anon.Body.Close()
	if anon.StatusCode != 403 {
		t.Fatalf("anonymous plain GET must be refused, got %d", anon.StatusCode)
	}
}

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

// A sync can be the first read after a hard deadline. It must notify the
// opponent too, rather than marking the version pushed after sending to self.
func TestWebSocketSyncBroadcastsTimeoutToBothSeats(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	var clock atomic.Int64
	clock.Store(time.Now().UnixNano())
	store.SetClock(func() time.Time { return time.Unix(0, clock.Load()) })
	catalog := fixture()
	api := NewAPI(store, catalog, t.TempDir())
	ts := httptest.NewServer(api.Handler())
	defer ts.Close()
	cookies := []string{strings.Repeat("a", 64), strings.Repeat("b", 64)}
	now := time.Unix(0, clock.Load())
	room := &game.Room{Code: "ABCDEFGHJKLM", Status: "playing", Mode: "pvp", Phase: "turn", CreatedAt: now, ExpiresAt: now.Add(24 * time.Hour), Round: 1, Players: []game.Player{
		{ID: fmt.Sprintf("%x", sha256.Sum256([]byte(cookies[0]))), Name: "A", Faction: "realms", Hand: []game.Card{{UID: "hand-a", Def: 0}}},
		{ID: fmt.Sprintf("%x", sha256.Sum256([]byte(cookies[1]))), Name: "B", Faction: "realms", Hand: []game.Card{{UID: "hand-b", Def: 0}}},
	}}
	if err := store.Create(room); err != nil {
		t.Fatal(err)
	}
	initial, err := store.Load(room.Code)
	if err != nil {
		t.Fatal(err)
	}
	connections := make([]net.Conn, 2)
	readers := make([]*bufio.Reader, 2)
	for seat := range connections {
		connections[seat], readers[seat] = wsDial(t, ts.URL+"/api/rooms/"+room.Code+"/ws", cookies[seat])
		defer connections[seat].Close()
		_ = connections[seat].SetReadDeadline(time.Now().Add(3 * time.Second))
		if _, _, err := readServerFrame(readers[seat]); err != nil {
			t.Fatal(err)
		}
	}
	clock.Store(initial.TurnDeadline.UnixNano())
	if err := writeClientFrame(connections[0], 0x1, []byte("sync")); err != nil {
		t.Fatal(err)
	}
	for seat, reader := range readers {
		_ = connections[seat].SetReadDeadline(time.Now().Add(3 * time.Second))
		_, payload, err := readServerFrame(reader)
		if err != nil {
			t.Fatalf("seat %d missed timeout: %v", seat, err)
		}
		var view game.View
		if err := json.Unmarshal(payload, &view); err != nil {
			t.Fatal(err)
		}
		if view.Version <= initial.Version || !view.Players[0].Passed || view.Turn != 1 {
			t.Fatalf("seat %d received stale timeout state: %+v", seat, view)
		}
	}
}
