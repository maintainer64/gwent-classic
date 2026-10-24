package server

import (
	"net/http/httptest"
	"testing"

	"github.com/maintainer64/gwent-classic/internal/game"
)

func TestCharacterSelectionUsesServerDeckAndSurvivesReload(t *testing.T) {
	catalog, err := game.DefaultCatalog()
	if err != nil {
		t.Fatal(err)
	}
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(NewAPI(store, catalog, t.TempDir()).Handler())
	defer srv.Close()
	human := client(t)
	status, body := get(t, human, srv.URL+"/api/catalog")
	if status != 200 || len(body["opponents"].([]any)) != 12 {
		t.Fatal("missing roster")
	}
	status, created := post(t, human, srv.URL+"/api/rooms", map[string]any{"name": "Игрок", "mode": "bot", "faction": "realms", "bot": map[string]any{"deckMode": "opponent", "opponent": "leshen", "difficulty": "hard"}})
	if status != 201 {
		t.Fatalf("create: %d %+v", status, created)
	}
	base := srv.URL + "/api/rooms/" + created["code"].(string)
	status, restored := get(t, human, base)
	if status != 200 || restored["bot"].(map[string]any)["opponent"] != "leshen" {
		t.Fatal("reload lost character")
	}
	opponent := restored["players"].([]any)[1].(map[string]any)
	if opponent["name"] != "Леший" || opponent["faction"] != "monsters" {
		t.Fatal("wrong character", opponent)
	}
	if _, leaked := opponent["hand"]; leaked {
		t.Fatal("hand leaked")
	}
	status, _ = post(t, human, srv.URL+"/api/rooms", map[string]any{"name": "Игрок", "mode": "bot", "faction": "realms", "bot": map[string]any{"deckMode": "opponent", "opponent": "leshen", "leader": 1}})
	if status != 400 {
		t.Fatal("client changed fixed leader")
	}
}
