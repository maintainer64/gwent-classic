package server

import (
	"github.com/maintainer64/gwent-classic/internal/game"
	"net/http/httptest"
	"testing"
	"time"
)

func TestTimerCreationValidationAndSharedPVPSettings(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	api := NewAPI(store, fixture(), t.TempDir())
	server := httptest.NewServer(api.Handler())
	defer server.Close()
	alice, bob := client(t), client(t)
	for _, timer := range []map[string]any{{"minutes": -1, "mode": "hard"}, {"minutes": 1, "mode": "unknown"}} {
		status, body := post(t, alice, server.URL+"/api/rooms", map[string]any{"name": "Alice", "faction": "realms", "mode": "pvp", "timer": timer})
		if status != 400 || body["code"] != "invalid_timer" {
			t.Fatalf("invalid timer accepted: %d %+v", status, body)
		}
	}
	status, room := post(t, alice, server.URL+"/api/rooms", map[string]any{"name": "Alice", "faction": "realms", "mode": "pvp", "timer": map[string]any{"minutes": 7.25, "mode": "soft"}})
	if status != 201 {
		t.Fatalf("create: %d %+v", status, room)
	}
	code := room["code"].(string)
	status, joined := post(t, bob, server.URL+"/api/rooms/"+code+"/join", map[string]any{"name": "Bob", "faction": "realms", "expectedVersion": room["version"]})
	if status != 200 {
		t.Fatalf("join: %d %+v", status, joined)
	}
	timer := joined["timer"].(map[string]any)
	if timer["minutes"] != 7.25 || timer["mode"] != "soft" {
		t.Fatal("guest did not receive host timer")
	}
	restored, err := store.Load(code)
	if err != nil || restored.TimerSettings() != (game.TurnTimer{Minutes: 7.25, Mode: game.TimerSoft}) {
		t.Fatal("timer was not persisted")
	}
}

// A malicious client must not race a request in after the server deadline.
// Store.read advances the room under its mutex BEFORE validating the version.
func TestHardTurnDeadlineRejectsLateActionsAcrossReloads(t *testing.T) {
	now := time.Date(2026, 10, 20, 10, 0, 0, 0, time.UTC)
	catalog := game.Catalog{{Name: "Soldier A", Deck: "realms", Row: "close", Strength: "5", Count: "1"}, {Name: "Soldier B", Deck: "realms", Row: "ranged", Strength: "5", Count: "1"}}
	s, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s.SetCatalog(catalog)
	s.SetClock(func() time.Time { return now })
	room := &game.Room{
		Code: "ABCDEFGHJKLM", Status: "playing", Mode: "pvp", Phase: "turn",
		CreatedAt: now, ExpiresAt: now.Add(24 * time.Hour), Turn: 0,
		Players: []game.Player{
			{Name: "A", Faction: "realms", Hand: []game.Card{{UID: "card-a", Def: 0}}},
			{Name: "B", Faction: "realms", Hand: []game.Card{{UID: "card-b", Def: 1}}},
		},
	}
	if err := s.Create(room); err != nil {
		t.Fatal(err)
	}
	first, err := s.Load(room.Code)
	if err != nil {
		t.Fatal(err)
	}
	if first.TurnDeadline.IsZero() || first.Version == 0 {
		t.Fatal("first load must arm persisted deadline")
	}
	version := first.Version
	expected := first.TurnDeadline
	// Repeated GET/Load calls may never extend the clock.
	now = now.Add(25 * time.Second)
	second, err := s.Load(room.Code)
	if err != nil {
		t.Fatal(err)
	}
	if second.Version != version || !second.TurnDeadline.Equal(expected) {
		t.Fatal("refresh extended a deadline")
	}
	now = expected
	called := false
	_, err = s.Change(room.Code, version, func(*game.Room) error { called = true; return nil })
	if err == nil || called {
		t.Fatal("late action ran instead of timing out first")
	}
	expired, err := s.Load(room.Code)
	if err != nil {
		t.Fatal(err)
	}
	if !expired.Players[0].Passed || expired.Turn != 1 || expired.Version == version {
		t.Fatal("server did not persist timeout")
	}
	if !expired.TurnDeadline.Equal(now.Add(time.Minute)) {
		t.Fatal("new player did not receive 60 seconds")
	}
	// An entirely new Store instance must see the same persisted server deadline.
	restarted, err := NewStore(s.dir)
	if err != nil {
		t.Fatal(err)
	}
	restarted.SetCatalog(catalog)
	restarted.SetClock(func() time.Time { return now })
	restored, err := restarted.Load(room.Code)
	if err != nil {
		t.Fatal(err)
	}
	if !restored.TurnDeadline.Equal(expired.TurnDeadline) {
		t.Fatal("restart reset the turn timer")
	}
}

func TestMedicChoiceCannotRenewServerDeadline(t *testing.T) {
	now := time.Date(2026, 10, 20, 10, 0, 0, 0, time.UTC)
	c := game.Catalog{{Name: "Soldier A", Deck: "realms", Row: "close", Strength: "5", Count: "1"}, {Name: "Soldier B", Deck: "realms", Row: "ranged", Strength: "5", Count: "1"}}
	s, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s.SetCatalog(c)
	s.SetClock(func() time.Time { return now })
	r := &game.Room{Code: "ZXCVBN234567", Status: "playing", Mode: "pvp", Phase: "turn",
		CreatedAt: now, ExpiresAt: now.Add(24 * time.Hour),
		Players: []game.Player{{Hand: []game.Card{{UID: "a", Def: 0}}}, {Hand: []game.Card{{UID: "b", Def: 1}}}},
	}
	if err := s.Create(r); err != nil {
		t.Fatal(err)
	}
	first, err := s.Load(r.Code)
	if err != nil {
		t.Fatal(err)
	}
	deadline := first.TurnDeadline
	now = now.Add(45 * time.Second)
	chained, err := s.Change(r.Code, first.Version, func(room *game.Room) error { room.PendingOwner = 1; return nil })
	if err != nil {
		t.Fatal(err)
	}
	if !chained.TurnDeadline.Equal(deadline) {
		t.Fatal("medic chain extended deadline")
	}
	now = now.Add(15 * time.Second)
	after, err := s.Load(r.Code)
	if err != nil {
		t.Fatal(err)
	}
	if after.PendingOwner != 0 || !after.Players[0].Passed {
		t.Fatal("pending choices must not defeat hard timer")
	}
}

func TestSoftTimerPersistsAndAllowsLateActions(t *testing.T) {
	now := time.Date(2026, 10, 20, 10, 0, 0, 0, time.UTC)
	c := game.Catalog{{Name: "A", Deck: "realms", Row: "close", Strength: "5", Count: "1"}, {Name: "B", Deck: "realms", Row: "ranged", Strength: "5", Count: "1"}}
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store.SetCatalog(c)
	store.SetClock(func() time.Time { return now })
	room := &game.Room{Code: "SOFTABCDEFGH", Status: "playing", Phase: "turn", Mode: "pvp", CreatedAt: now, ExpiresAt: now.Add(game.RoomLifetime), Timer: &game.TurnTimer{Minutes: 3.5, Mode: game.TimerSoft},
		Players: []game.Player{{Hand: []game.Card{{UID: "a", Def: 0}}}, {Hand: []game.Card{{UID: "b", Def: 1}}}}}
	if err := store.Create(room); err != nil {
		t.Fatal(err)
	}
	first, err := store.Load(room.Code)
	if err != nil {
		t.Fatal(err)
	}
	expected := first.TurnDeadline
	now = expected.Add(time.Minute)
	restarted, err := NewStore(store.dir)
	if err != nil {
		t.Fatal(err)
	}
	restarted.SetCatalog(c)
	restarted.SetClock(func() time.Time { return now })
	restored, err := restarted.Load(room.Code)
	if err != nil {
		t.Fatal(err)
	}
	if restored.TimerSettings() != *room.Timer || !restored.TurnDeadline.Equal(expected) || restored.Version != first.Version || restored.Players[0].Passed {
		t.Fatal("reload changed soft timer or passed player")
	}
	if _, err := restarted.Change(room.Code, restored.Version, func(r *game.Room) error { return r.Apply(0, game.Action{Type: "pass"}, c) }); err != nil {
		t.Fatalf("soft timeout rejected action: %v", err)
	}
}
