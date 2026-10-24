package game

import (
	"fmt"
	"testing"
)

func weatherRoom(t *testing.T) (*Room, Catalog) {
	t.Helper()
	r, _ := manualRoom()
	c := realCatalog(t)
	r.Phase = "turn"
	for seat := range r.Players {
		for _, row := range []string{"close", "ranged", "siege"} {
			for def, d := range c {
				if d.Row == row && d.Power() > 3 && d.Ability == "" {
					r.Players[seat].Rows[row] = []Card{{UID: fmt.Sprintf("unit-%d-%s", seat, row), Def: def}}
					break
				}
			}
		}
		r.Players[seat].Hand = []Card{{UID: fmt.Sprintf("spare-%d", seat), Def: r.Players[seat].Rows["close"][0].Def}}
	}
	return r, c
}
func findAbility(t *testing.T, c Catalog, ability, deck string) int {
	t.Helper()
	for def, d := range c {
		if d.Deck == deck && d.Has(ability) {
			return def
		}
	}
	t.Fatalf("missing %s", ability)
	return -1
}

func TestEveryWeatherAndClearProduceOrderedPublicFrames(t *testing.T) {
	for _, weather := range []string{"frost", "fog", "rain", "storm"} {
		t.Run(weather, func(t *testing.T) {
			r, c := weatherRoom(t)
			kind := findAbility(t, c, weather, "weather")
			r.Players[0].Hand = append(r.Players[0].Hand, Card{UID: "weather", Def: kind})
			r.Players[1].Hand = append(r.Players[1].Hand, Card{UID: "clear", Def: findAbility(t, c, "clear", "weather")})
			hero := findAbility(t, c, "hero", "neutral")
			r.Players[0].Rows["ranged"] = append(r.Players[0].Rows["ranged"], Card{UID: "hero", Def: hero})
			if err := r.Apply(0, Action{Type: "play", UID: "weather"}, c); err != nil {
				t.Fatal(err)
			}
			for seat := range r.Players {
				for _, row := range []string{"close", "ranged", "siege"} {
					unit := r.Players[seat].Rows[row][0]
					expected := c[unit.Def].Power()
					if weather == "frost" && row == "close" || weather == "fog" && row == "ranged" || weather == "rain" && row == "siege" || weather == "storm" && row != "close" {
						expected = 1
					}
					if actual := r.unitPowers(seat, row, c)[unit.UID]; actual != expected {
						t.Fatalf("%s seat %d: got %d want %d", row, seat, actual, expected)
					}
				}
			}
			if r.unitPowers(0, "ranged", c)["hero"] != c[hero].Power() {
				t.Fatal("weather weakened hero")
			}
			if err := r.Apply(1, Action{Type: "play", UID: "clear"}, c); err != nil {
				t.Fatal(err)
			}
			var frames []MatchEvent
			for _, e := range r.Transitions {
				if e.Type == "weather" {
					frames = append(frames, e)
				}
			}
			if len(frames) != 2 || frames[0].Actor != 0 || frames[1].Actor != 1 || len(frames[0].Frame.WeatherCards) != 1 || len(frames[1].Frame.WeatherCards) != 0 || len(frames[1].Frame.Weather) != 0 {
				t.Fatal("weather/clear did not retain separate frames")
			}
			for seat := range r.Players {
				for _, row := range []string{"close", "ranged", "siege"} {
					for _, unit := range r.Project(seat, c).Players[seat].Rows[row] {
						if unit.Power != unit.BasePower {
							t.Fatal("clear did not restore printed strength")
						}
					}
				}
			}
		})
	}
}

func TestWeatherLeadersSearchDeckAndApplyEffects(t *testing.T) {
	for _, example := range []struct{ leader, weather string }{{"foltest_king", "fog"}, {"emhyr_imperial", "rain"}, {"francesca_pureblood", "frost"}, {"eredin_king", "storm"}} {
		t.Run(example.leader, func(t *testing.T) {
			r, c := weatherRoom(t)
			leader := -1
			for def, d := range c {
				if d.Has(example.leader) {
					leader = def
					break
				}
			}
			if leader < 0 {
				t.Fatal("missing leader")
			}
			r.Players[0].Leader = leader + 1
			r.Players[0].Faction = c[leader].Deck
			r.Players[0].Deck = []Card{{UID: "from-deck", Def: findAbility(t, c, example.weather, "weather")}}
			if err := r.Apply(0, Action{Type: "leader"}, c); err != nil {
				t.Fatal(err)
			}
			if !r.Players[0].LeaderUsed || len(r.Players[0].Deck) != 0 || len(r.WeatherCards) != 1 || r.WeatherCards[0].Card.UID != "from-deck" {
				t.Fatal("leader did not play weather from deck")
			}
			found := false
			for _, w := range r.Weather {
				if w == example.weather {
					found = true
				}
			}
			if !found {
				t.Fatal("leader weather effect missing")
			}
		})
	}
	r, c := weatherRoom(t)
	r.Players[0].Leader = findAbility(t, c, "foltest_king", "realms") + 1
	r.Players[0].Deck = nil
	r.Players[0].Hand = append(r.Players[0].Hand, Card{UID: "fog-in-hand", Def: findAbility(t, c, "fog", "weather")})
	if err := r.Apply(0, Action{Type: "leader"}, c); err != nil {
		t.Fatal(err)
	}
	if len(r.Weather) != 0 || !r.Players[0].LeaderUsed {
		t.Fatal("leader must not take weather from hand; original no-target rule changed")
	}
}
