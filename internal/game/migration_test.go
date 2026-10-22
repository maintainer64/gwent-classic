package game

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func realCatalog(t *testing.T) Catalog {
	t.Helper()
	c, err := DefaultCatalog()
	if err != nil {
		t.Fatal(err)
	}
	return c
}
func TestCatalogDataAndLocalizationAreComplete(t *testing.T) {
	c := realCatalog(t)
	source, err := os.ReadFile(filepath.Join("..", "..", "cards.js"))
	if err != nil {
		t.Fatal(err)
	}
	original, err := ParseLegacyCards(source)
	if err != nil {
		t.Fatal(err)
	}
	if len(c) != 216 || len(c) != len(original) {
		t.Fatal("catalog count")
	}
	seen := map[string]bool{}
	for i, d := range c {
		old := original[i]
		if d.Name != old.Name || d.Deck != old.Deck || d.Row != old.Row || d.Ability != old.Ability || d.Filename != old.Filename || d.Count != old.Count || d.Muster != old.Muster || d.Power() != old.Power() {
			t.Fatalf("rule data changed at %d", i)
		}
		if d.NameRu == "" || d.NameRu == d.Name || d.Description() == "" || d.DescriptionEn() == "" || seen[d.Key] {
			t.Fatalf("missing translation/key: %d %+v", i, d)
		}
		seen[d.Key] = true
		for _, ability := range strings.Fields(d.Ability) {
			if _, ok := AbilityDescriptionsEnglish[ability]; !ok {
				if _, ok := LeaderDescriptionsEnglish[ability]; !ok {
					t.Fatalf("missing English effect: %s", ability)
				}
			}
		}
		for _, a := range strings.Fields(d.Ability) {
			if _, ok := AbilityDescriptions[a]; !ok {
				if _, ok := supportedLeaders[a]; !ok {
					t.Fatalf("missing ability text: %s", a)
				}
			}
		}
		if _, err := os.Stat(filepath.Join("..", "..", strings.TrimPrefix(d.Artwork(), "/"))); err != nil {
			t.Fatalf("missing artwork %s", d.Artwork())
		}
	}
}
func TestAnimationHistoryPreservesIntermediateBoard(t *testing.T) {
	c := realCatalog(t)
	unit := c.Find("Vesemir")
	scorch := c.Find("Scorch")
	r := &Room{Mode: "bot", Status: "playing", Phase: "turn", Round: 1, Turn: 0, Bot: &BotOptions{Difficulty: BotHard, Style: "balanced"}, Players: []Player{
		{Name: "Игрок", Faction: "realms", Rows: rows(), Special: rows(), Horn: map[string]bool{}, Mardroeme: map[string]bool{}, Hand: []Card{{UID: "visible-unit", Def: unit}}, LeaderUsed: true},
		{Name: "Бот", Faction: "nilfgaard", Rows: rows(), Special: rows(), Horn: map[string]bool{}, Mardroeme: map[string]bool{}, Hand: []Card{{UID: "scorch", Def: scorch}}, LeaderUsed: true},
	}}
	if err := r.Apply(0, Action{Type: "play", UID: "visible-unit", Row: "close"}, c); err != nil {
		t.Fatal(err)
	}
	sawPlaced, sawDestroyed := false, false
	for _, e := range r.Project(0, c).Transitions {
		if e.Type == "placed" && e.Card != nil && e.Card.UID == "visible-unit" {
			sawPlaced = true
			if len(e.Frame.Players[0].Rows["close"]) != 1 {
				t.Fatal("intermediate placement lost")
			}
		}
		if e.Type == "destroyed" && e.Card != nil && e.Card.UID == "visible-unit" {
			sawDestroyed = true
		}
	}
	if !sawPlaced || !sawDestroyed {
		t.Fatalf("missing timeline: placed=%v destroyed=%v", sawPlaced, sawDestroyed)
	}
	for i, p := range r.Players {
		for _, cards := range p.Rows {
			for _, card := range cards {
				if card.UID == "visible-unit" {
					t.Fatalf("unit survived on seat %d", i)
				}
			}
		}
	}
}
func TestPrivateDrawsCannotLeakThroughEvents(t *testing.T) {
	c := realCatalog(t)
	r, err := NewRoom("ABCDEFGHIJKL", "bot", "human", "Игрок", "realms", c, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(r.Project(0, c))
	for _, card := range append(append([]Card{}, r.Players[1].Hand...), r.Players[1].Deck...) {
		if bytes.Contains(data, []byte(card.UID)) {
			t.Fatal("opponent card uid leaked", card.UID)
		}
	}
	for _, e := range r.Project(0, c).Transitions {
		if e.PrivateFor == 2 && e.Card != nil {
			t.Fatal("private bot draw exposed")
		}
		for _, p := range e.Frame.Players {
			if len(p.Hand) > 0 || len(p.DeckChoices) > 0 || len(p.Peek) > 0 {
				t.Fatal("animation frame exposes a private zone")
			}
		}
	}
}
func TestStableDeckKeysAndLives(t *testing.T) {
	c := realCatalog(t)
	entries := []DeckEntry{}
	for _, d := range DeckCatalog(c) {
		if d.Faction == "realms" && d.Row != "leader" {
			entries = append(entries, DeckEntry{Key: d.Key, Def: -1, Count: d.MaxCopies})
		}
	}
	// Keep only units and enough copies, without relying on array positions.
	if err := ValidateDeck(c, "realms", entries); err != nil {
		t.Fatal(err)
	}
	r, err := NewRoomWithDeck("ABCDEFGHIJKL", "bot", "u", "Игрок", "realms", c, time.Now(), 0, botDefaults(), entries)
	if err != nil {
		t.Fatal(err)
	}
	for _, card := range r.Players[0].Deck {
		if card.Def < 0 || card.Def >= len(c) {
			t.Fatal("key was not resolved")
		}
	}
	r.RoundHistory = []RoundResult{{Winner: 0}, {Winner: -1}}
	v := r.Project(0, c)
	if v.Players[0].Lives != 1 || v.Players[1].Lives != 0 {
		t.Fatalf("wrong lives: %d %d", v.Players[0].Lives, v.Players[1].Lives)
	}
}
func TestCompleteMatchesAllFactionsDifficultiesAndStyles(t *testing.T) {
	c := realCatalog(t)
	for _, f := range Factions {
		for _, difficulty := range []BotDifficulty{BotEasy, BotNormal, BotHard} {
			for _, style := range []string{"balanced", "aggressive", "economy"} {
				t.Run(f+"/"+string(difficulty)+"/"+style, func(t *testing.T) {
					r, err := NewRoomConfigured("ABCDEFGHIJKL", "bot", "u", "Игрок", f, c, time.Now(), 0, BotOptions{Difficulty: difficulty, Style: style, DeckMode: BotFaction, Faction: f})
					if err != nil {
						t.Fatal(err)
					}
					for step := 0; step < 200 && r.Status == "playing"; step++ {
						var action Action
						switch {
						case r.Phase == "mulligan":
							action = Action{Type: "ready"}
						case r.Initiative == 1:
							action = Action{Type: "initiative", Target: "self"}
						case r.PendingOwner == 1:
							options := r.eligibleGrave(0, c)
							if len(options) == 0 {
								t.Fatal("medic stalled")
							}
							action = Action{Type: "revive", Target: options[0].UID}
						default:
							if r.Turn != 0 {
								t.Fatal("bot failed to finish its turn")
							}
							action = Action{Type: "pass"}
							if !r.Players[1].Passed || r.Score(0, c) <= r.Score(1, c) {
								for _, a := range r.candidateActions(0, c) {
									sim := r.simulation()
									var err error
									if a.Type == "leader" {
										err = sim.activateLeader(0, a, c)
									} else {
										err = sim.play(0, a, c)
									}
									if err == nil {
										action = a
										break
									}
								}
							}
						}
						if err := r.Apply(0, action, c); err != nil {
							t.Fatalf("step %d %+v: %v", step, action, err)
						}
					}
					if r.Status != "finished" {
						t.Fatal("match did not finish")
					}
					if len(r.RoundHistory) < 2 || len(r.RoundHistory) > 3 {
						t.Fatal("invalid round count")
					}
				})
			}
		}
	}
}
