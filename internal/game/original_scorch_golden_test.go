package game

import (
	"encoding/json"
	"os"
	"slices"
	"strconv"
	"testing"
)

func TestScorchTransitionsMatchOriginalJavaScript(t *testing.T) {
	var fixtures struct {
		Cases []struct {
			Mode    string   `json:"mode"`
			Weather []string `json:"weather"`
			Horns   []bool   `json:"horns"`
			Units   []struct {
				UID     string `json:"uid"`
				Name    string `json:"name"`
				Owner   int    `json:"owner"`
				Row     string `json:"row"`
				Power   int    `json:"power"`
				Ability string `json:"ability"`
			} `json:"units"`
			Expected struct {
				Rows   [][]string `json:"rows"`
				Graves [][]string `json:"graves"`
				Scores []int      `json:"scores"`
			} `json:"expected"`
		} `json:"cases"`
	}
	raw, err := os.ReadFile("testdata/original-scorch-goldens.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	if len(fixtures.Cases) != 120 {
		t.Fatalf("incomplete Scorch oracle: %d cases", len(fixtures.Cases))
	}
	for index, fixture := range fixtures.Cases {
		t.Run(fixture.Mode+"/"+strconv.Itoa(index), func(t *testing.T) {
			r, c := manualRoom()
			r.Weather = fixture.Weather
			rowNames := []string{"close", "ranged", "siege"}
			for player := range r.Players {
				for i, row := range rowNames {
					r.Players[player].Horn[row] = fixture.Horns[player*3+i]
				}
			}
			var source Card
			for _, unit := range fixture.Units {
				definition := Definition{Name: unit.Name, Deck: "realms", Row: unit.Row, Strength: strconv.Itoa(unit.Power), Ability: unit.Ability, Count: "1"}
				c = append(c, definition)
				card := Card{UID: unit.UID, Def: len(c) - 1}
				r.Players[unit.Owner].Rows[unit.Row] = append(r.Players[unit.Owner].Rows[unit.Row], card)
				if card.UID == "source" {
					source = card
				}
			}
			if fixture.Mode == "special" {
				c = append(c, Definition{Name: "Scorch source", Deck: "special", Row: "", Ability: "scorch", Count: "1"})
				source = Card{UID: "source", Def: len(c) - 1}
				r.Players[0].Hand = []Card{source}
				if err := r.play(0, Action{UID: source.UID}, c); err != nil {
					t.Fatal(err)
				}
			} else {
				r.onPlaced(0, source, c[source.Def].Row, c)
			}
			for player := range r.Players {
				for rowIndex, row := range rowNames {
					actual := []string{}
					for _, card := range r.Players[player].Rows[row] {
						actual = append(actual, card.UID)
					}
					slices.Sort(actual)
					expected := fixture.Expected.Rows[player*3+rowIndex]
					if !slices.Equal(actual, expected) {
						t.Fatalf("seat %d %s: got %v, want %v", player, row, actual, expected)
					}
				}
				actual := []string{}
				for _, card := range r.Players[player].Grave {
					actual = append(actual, card.UID)
				}
				slices.Sort(actual)
				if !slices.Equal(actual, fixture.Expected.Graves[player]) {
					t.Fatalf("seat %d grave: got %v, want %v", player, actual, fixture.Expected.Graves[player])
				}
				if got := r.Score(player, c); got != fixture.Expected.Scores[player] {
					t.Fatalf("seat %d score: got %d, want %d", player, got, fixture.Expected.Scores[player])
				}
			}
		})
	}
}
