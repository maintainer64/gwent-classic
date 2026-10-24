package server

import (
	"net/http/httptest"
	"testing"
)

func TestEarlyInvitationStartsOnlyAfterHostFinalizesSetup(t *testing.T) {
	for _, hostFirst := range []bool{false, true} {
		t.Run(map[bool]string{false: "guest joins first", true: "host confirms first"}[hostFirst], func(t *testing.T) {
			store, err := NewStore(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			api := NewAPI(store, fixture(), t.TempDir())
			srv := httptest.NewServer(api.Handler())
			defer srv.Close()
			host, guest, outsider := client(t), client(t), client(t)
			status, reserved := post(t, host, srv.URL+"/api/rooms", map[string]any{"name": "Host", "mode": "pvp", "faction": "realms", "lobby": true})
			if status != 201 || reserved["status"] != "waiting" || reserved["lobby"] != true {
				t.Fatalf("reserve: %d %+v", status, reserved)
			}
			base := srv.URL + "/api/rooms/" + reserved["code"].(string)
			if status, _ := get(t, outsider, base); status != 403 {
				t.Fatal("private room leaked")
			}
			prepare := func(version any) {
				t.Helper()
				status, result := post(t, host, base+"/prepare", map[string]any{"name": "Final Host", "faction": "nilfgaard", "expectedVersion": version, "timer": map[string]any{"minutes": 2.5, "mode": "soft"}})
				if status != 200 {
					t.Fatalf("prepare: %d %+v", status, result)
				}
			}
			if hostFirst {
				prepare(reserved["version"])
			}
			// Version zero deliberately predates the host's setup when hostFirst=true.
			status, joined := post(t, guest, base+"/join", map[string]any{"name": "Guest", "faction": "monsters", "expectedVersion": 0})
			if status != 200 {
				t.Fatalf("join: %d %+v", status, joined)
			}
			if !hostFirst {
				if joined["status"] != "waiting" {
					t.Fatal("guest started game before host was ready")
				}
				for _, raw := range joined["players"].([]any) {
					if raw.(map[string]any)["handCount"].(float64) != 0 {
						t.Fatal("cards dealt before host finalized deck")
					}
				}
				version := joined["version"]
				body := map[string]any{"name": "Intruder", "faction": "realms", "expectedVersion": version}
				if status, _ := post(t, guest, base+"/prepare", body); status != 403 {
					t.Fatal("guest reconfigured host")
				}
				if status, _ := post(t, outsider, base+"/prepare", body); status != 403 {
					t.Fatal("outsider reconfigured host")
				}
				prepare(version)
			}
			status, ready := get(t, guest, base)
			if status != 200 || ready["status"] != "playing" || ready["phase"] != "mulligan" {
				t.Fatalf("start: %d %+v", status, ready)
			}
			players := ready["players"].([]any)
			first := players[0].(map[string]any)
			if first["name"] != "Final Host" || first["faction"] != "nilfgaard" {
				t.Fatal("final host setup was not used")
			}
			if _, leaked := first["hand"]; leaked {
				t.Fatal("host hand leaked to guest")
			}
			timer := ready["timer"].(map[string]any)
			if timer["minutes"].(float64) != 2.5 || timer["mode"] != "soft" {
				t.Fatal("final timer was not shared")
			}
			if status, _ := post(t, outsider, base+"/join", map[string]any{"name": "Third", "faction": "realms", "expectedVersion": 0}); status == 200 {
				t.Fatal("third player joined")
			}
		})
	}
}

func TestCannotReserveLobbyForBot(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	api := NewAPI(store, fixture(), t.TempDir())
	srv := httptest.NewServer(api.Handler())
	defer srv.Close()
	status, _ := post(t, client(t), srv.URL+"/api/rooms", map[string]any{"name": "Host", "mode": "bot", "faction": "realms", "lobby": true})
	if status != 400 {
		t.Fatal("bot room allowed early multiplayer lobby")
	}
}
