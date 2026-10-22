package game

import (
	"testing"
)

// All playable definitions in the original catalogue must be accepted by the
// authoritative Go move path. The test runs against the REAL 216-card catalogue
// in every environment, including the Docker build. Missing assets fail tests.
func TestEveryOriginalPlayableCardHasLegalMove(t *testing.T) {
	c := realCatalog(t)
	count := 0
	for i, d := range c {
		if d.Copies() <= 0 || d.Row == "leader" {
			continue
		}
		count++
		r := &Room{Status: "playing", Turn: 0, Round: 1, Players: []Player{
			{Name: "Alice", Rows: rows(), Special: rows(), Horn: map[string]bool{}, Mardroeme: map[string]bool{}},
			{Name: "Bob", Rows: rows(), Special: rows(), Horn: map[string]bool{}, Mardroeme: map[string]bool{}},
		}}
		card := Card{UID: "test", Def: i}
		r.Players[0].Hand = []Card{card}
		row := d.Row
		if row == "agile" {
			row = "close"
		}
		if d.Deck == "special" && (d.Has("horn") || d.Has("mardroeme")) {
			row = "close"
		}
		target := ""
		if d.Has("decoy") {
			helper := c.Find("Vesemir")
			if helper < 0 { // The synthetic fixture has no Vesemir.
				for j, x := range c {
					if isUnit(x) {
						helper = j
						break
					}
				}
			}
			if helper < 0 {
				t.Fatal("no target for Decoy")
			}
			r.Players[0].Rows["close"] = []Card{{UID: "target", Def: helper}}
			target = "target"
		}
		if err := r.play(0, Action{Type: "play", UID: card.UID, Row: row, Target: target}, c); err != nil {
			t.Errorf("cannot play card %d %q abilities=%q: %v", i, d.Name, d.Ability, err)
			continue
		}
		for _, left := range r.Players[0].Hand {
			if left.UID == card.UID {
				t.Errorf("card %d remains in hand after playing", i)
			}
		}
		_ = r.Score(0, c)
		_ = r.Score(1, c)
		_ = r.Project(0, c)
		_ = r.Project(1, c)
	}
	if count < 3 {
		t.Fatalf("catalogue test covered too few cards: %d", count)
	}
}
