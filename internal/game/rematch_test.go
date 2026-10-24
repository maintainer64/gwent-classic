package game

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

func deckDefinitions(cards []Card) map[int]int {
	out := map[int]int{}
	for _, card := range cards {
		out[card.Def]++
	}
	return out
}

func TestBotRematchPreservesRoomAndExactDecks(t *testing.T) {
	c := realCatalog(t)
	r, err := NewRoomConfigured("REMATCHABCDE", "bot", "alice", "Alice", "realms", c, time.Now(), 0, BotOptions{Difficulty: BotHard, Style: "economy", DeckMode: BotFaction, Faction: "skellige"})
	if err != nil {
		t.Fatal(err)
	}
	r.Timer = &TurnTimer{Minutes: 2.5, Mode: TimerSoft}
	before := r.Players
	options := *r.Bot
	ids := map[string]bool{}
	for _, p := range before {
		for _, card := range p.StartingDeck {
			ids[card.UID] = true
		}
	}
	r.Status, r.Phase, r.Winner, r.Round = "finished", "turn", 1, 3
	r.Players[0].LeaderUsed, r.Players[0].Wins = true, 1
	r.Players[0].Grave = append(r.Players[0].Grave, Card{UID: "summoned", Def: 0})
	r.Weather = []string{"storm"}
	r.PendingOwner = 1
	r.EventSeq = 70
	r.RoundHistory = []RoundResult{{ScoreA: 4, ScoreB: 9, Winner: 1}}
	if err := r.Apply(0, Action{Type: "rematch"}, c); err != nil {
		t.Fatal(err)
	}
	if r.Code != "REMATCHABCDE" || r.GameNumber != 2 || r.Status != "playing" || r.Phase != "mulligan" {
		t.Fatalf("bad rematch: %+v", r)
	}
	if !reflect.DeepEqual(*r.Bot, options) || r.Timer.Minutes != 2.5 || r.Timer.Mode != TimerSoft {
		t.Fatal("settings changed")
	}
	if len(r.Weather) != 0 || len(r.RoundHistory) != 0 || r.PendingOwner != 0 || r.EventSeq <= 70 {
		t.Fatal("old match state leaked or event IDs reset")
	}
	for i, p := range r.Players {
		if p.ID != before[i].ID || p.Faction != before[i].Faction || p.Leader != before[i].Leader || p.Wins != 0 || p.LeaderUsed || len(p.Hand) != 10 || len(p.Grave) != 0 {
			t.Fatal("player was not reset faithfully")
		}
		if !reflect.DeepEqual(deckDefinitions(p.StartingDeck), deckDefinitions(before[i].StartingDeck)) {
			t.Fatal("rematch changed deck composition")
		}
		for _, card := range append(append([]Card{}, p.Deck...), p.Hand...) {
			if ids[card.UID] {
				t.Fatal("old card UID reused")
			}
		}
	}
	public, _ := json.Marshal(r.Project(0, c))
	if strings.Contains(string(public), "startingDeck") {
		t.Fatal("opening deck leaked")
	}
}

func TestPvPRematchNeedsBothPlayersAndSurvivesSave(t *testing.T) {
	c := Fixture()
	r, err := NewRoom("REMATCHABCDE", "pvp", "a", "A", "realms", c, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Join("b", "B", "monsters", c); err != nil {
		t.Fatal(err)
	}
	if err := r.Apply(0, Action{Type: "rematch"}, c); err == nil {
		t.Fatal("restarted active match")
	}
	r.Status = "finished"
	if err := r.Apply(-1, Action{Type: "rematch"}, c); err == nil {
		t.Fatal("outsider restarted match")
	}
	if err := r.Apply(0, Action{Type: "rematch"}, c); err != nil {
		t.Fatal(err)
	}
	version := r.Version
	if r.Status != "finished" || !r.RematchReady[0] || r.RematchReady[1] {
		t.Fatal("did not wait for opponent")
	}
	if err := r.Apply(0, Action{Type: "rematch"}, c); err != nil || r.Version != version {
		t.Fatal("repeat request was not idempotent")
	}
	raw, _ := json.Marshal(r)
	var restored Room
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	if err := restored.Apply(1, Action{Type: "rematch"}, c); err != nil {
		t.Fatal(err)
	}
	if restored.GameNumber != 2 || restored.Phase != "mulligan" || restored.Players[0].ID != "a" || restored.Players[1].ID != "b" || restored.RematchReady != [2]bool{} {
		t.Fatal("rematch did not restore both players")
	}
}

func TestLegacyRematchRecoversPhysicalDecks(t *testing.T) {
	c := realCatalog(t)
	r, err := NewRoom("REMATCHABCDE", "pvp", "a", "A", "realms", c, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Join("b", "B", "nilfgaard", c); err != nil {
		t.Fatal(err)
	}
	expected := []map[int]int{deckDefinitions(r.Players[0].StartingDeck), deckDefinitions(r.Players[1].StartingDeck)}
	for i := range r.Players {
		r.Players[i].StartingDeck = nil
		r.Players[i].Hand[0].Boost = 8
	}
	r.Status = "finished"
	for seat := 0; seat < 2; seat++ {
		if err := r.Apply(seat, Action{Type: "rematch"}, c); err != nil {
			t.Fatal(err)
		}
	}
	for i, p := range r.Players {
		if !reflect.DeepEqual(deckDefinitions(p.StartingDeck), expected[i]) {
			t.Fatal("legacy deck composition changed")
		}
		for _, card := range p.StartingDeck {
			if card.Boost != 0 {
				t.Fatal("old boost carried into rematch")
			}
		}
	}
}
