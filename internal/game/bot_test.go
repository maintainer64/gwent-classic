package game

import (
	"encoding/json"
	"reflect"
	"slices"
	"testing"
)

func botFixture() (Catalog, *Room) {
	c := Catalog{
		{Name: "Weak", Row: "close", Strength: "2"},
		{Name: "Strong", Row: "close", Strength: "10"},
		{Name: "Spy", Row: "close", Strength: "0", Ability: "spy"},
		{Name: "Medic", Row: "ranged", Strength: "5", Ability: "medic"},
		{Name: "Decoy", Deck: "special", Ability: "decoy"},
		{Name: "Clear", Deck: "weather", Ability: "clear"},
		{Name: "Frost", Deck: "weather", Ability: "frost"},
		{Name: "Bond", Row: "close", Strength: "4", Ability: "bond"},
		{Name: "Group A", Row: "close", Strength: "4", Ability: "muster", Muster: "Group"},
		{Name: "Group B", Row: "close", Strength: "4", Ability: "muster", Muster: "Group"},
		{Name: "Agile", Row: "agile", Strength: "6"},
		{Name: "Hero", Row: "close", Strength: "15", Ability: "hero"},
		{Name: "Horn", Deck: "special", Ability: "horn"},
		{Name: "Scorch", Deck: "special", Ability: "scorch"},
		{Name: "Siege", Row: "siege", Strength: "5"},
		{Name: "Eight", Row: "close", Strength: "8"},
		{Name: "Six", Row: "close", Strength: "6"},
		{Name: "Agile Medic", Row: "agile", Strength: "2", Ability: "medic"},
		{Name: "Second Medic", Row: "close", Strength: "4", Ability: "medic"},
		{Name: "Archer", Row: "ranged", Strength: "3"},
	}
	r := &Room{Mode: "bot", Status: "playing", Phase: "turn", Round: 1, Turn: 1, Bot: &BotOptions{Difficulty: BotNormal, Style: "balanced"}}
	for range 2 {
		r.Players = append(r.Players, Player{Faction: "realms", Rows: rows(), Special: rows(), Horn: map[string]bool{}, Mardroeme: map[string]bool{}, LeaderUsed: true, Redraws: 2})
	}
	return c, r
}

func TestBotMulliganPreservesAbilitiesAndRejectsRedundantMuster(t *testing.T) {
	c, r := botFixture()
	p := &r.Players[1]
	p.Hand = []Card{{UID: "spy", Def: 2}, {UID: "medic", Def: 3}, {UID: "decoy", Def: 4}, {UID: "weak", Def: 0}}
	p.Deck = []Card{{UID: "replacement", Def: 1}}
	if uid := r.botRedrawChoice(1, c); uid != "weak" {
		t.Fatalf("discarded %s instead of weak unit", uid)
	}
	p.Hand = []Card{{UID: "spy", Def: 2}, {UID: "hero", Def: 11}}
	p.Deck = []Card{{UID: "replacement", Def: 0}}
	if uid := r.botRedrawChoice(1, c); uid != "" {
		t.Fatalf("weakened a strong opening by discarding %s", uid)
	}
	p.Hand = []Card{{UID: "first-muster", Def: 8}, {UID: "second-muster", Def: 9}, {UID: "spy", Def: 2}}
	p.Deck = []Card{{UID: "replacement", Def: 0}}
	if uid := r.botRedrawChoice(1, c); uid != "first-muster" {
		t.Fatalf("didn't return duplicate muster: %s", uid)
	}
	p.Hand = p.Hand[1:]
	if uid := r.botRedrawChoice(1, c); uid != "" {
		t.Fatalf("discarded the last muster representative: %s", uid)
	}
}

func TestBotPassedRoundUsesCheapestWinAndPlansSmallCombination(t *testing.T) {
	for _, level := range []BotDifficulty{BotNormal, BotHard} {
		t.Run(string(level), func(t *testing.T) {
			c, r := botFixture()
			r.Players[0].Passed = true
			r.Players[0].Rows["close"] = []Card{{UID: "opponent", Def: 0}}
			r.Players[1].Hand = []Card{{UID: "strong", Def: 1}, {UID: "six", Def: 16}}
			if a := r.botDecision(1, c, level); a.UID != "six" {
				t.Fatalf("overspent: %+v", a)
			}
			// Two sixes win while preserving the 15-point hero for the next round.
			r.Players[0].Rows["close"] = []Card{{UID: "opponent", Def: 1}, {UID: "extra", Def: 0}}
			r.Players[1].Hand = []Card{{UID: "hero", Def: 11}, {UID: "six-a", Def: 16}, {UID: "six-b", Def: 16}}
			// A Northern Realms tie isn't a win: make the target 10 instead.
			r.Players[0].Rows["close"] = r.Players[0].Rows["close"][:1]
			if a := r.botDecision(1, c, level); a.UID != "six-a" && a.UID != "six-b" {
				t.Fatalf("failed to save hero using two cards: %+v", a)
			}
		})
	}
}

func TestBotRespectsNilfgaardTieAndDoesNotOverplayMatchWin(t *testing.T) {
	c, r := botFixture()
	r.Players[0].Passed = true
	r.Players[1].Faction = "nilfgaard"
	r.Players[1].Hand = []Card{{UID: "strong", Def: 1}}
	if a := r.botDecision(1, c, BotNormal); a.Type != "pass" {
		t.Fatalf("ignored Nilfgaard tie: %+v", a)
	}
	if a := r.botDecision(1, c, BotEasy); a.Type != "pass" {
		t.Fatalf("easy bot overplayed a won round: %+v", a)
	}
	r.Players[1].Wins = 1
	r.Players[1].Rows["close"] = []Card{{UID: "winning-unit", Def: 1}, {UID: "spy-to-recover", Def: 2}}
	r.Players[1].Hand = []Card{{UID: "decoy", Def: 4}}
	r.Players[1].Deck = []Card{{UID: "draw", Def: 11}}
	if a := r.botDecision(1, c, BotHard); a.Type != "pass" {
		t.Fatalf("continued after securing match: %+v", a)
	}
}

func TestBotCanRecoverSpyWithoutGivingUpWonRound(t *testing.T) {
	c, r := botFixture()
	r.Players[0].Passed = true
	r.Players[0].Rows["close"] = []Card{{UID: "opponent", Def: 0}}
	r.Players[1].Rows["close"] = []Card{{UID: "strong-on-board", Def: 1}, {UID: "spy-on-board", Def: 2}}
	r.Players[1].Hand = []Card{{UID: "decoy", Def: 4}}
	r.Players[1].Deck = []Card{{UID: "draw-a", Def: 1}, {UID: "draw-b", Def: 11}}
	if a := r.botDecision(1, c, BotNormal); a.UID != "decoy" || a.Target != "spy-on-board" {
		t.Fatalf("didn't recover useful spy: %+v", a)
	}
}

func TestBotConcedesExpensiveRoundButFightsAtMatchPoint(t *testing.T) {
	c, r := botFixture()
	r.Players[0].Rows["close"] = []Card{{UID: "a", Def: 11}, {UID: "b", Def: 1}, {UID: "c", Def: 1}}
	r.Players[0].Hand = make([]Card, 4)
	r.Players[1].Hand = []Card{{UID: "hero", Def: 11}, {UID: "strong", Def: 1}, {UID: "six", Def: 16}}
	if a := r.botDecision(1, c, BotNormal); a.Type != "pass" {
		t.Fatalf("chased hopeless first round: %+v", a)
	}
	r.Players[0].Rows["close"] = r.Players[0].Rows["close"][:2]
	r.Players[0].Wins = 1
	if a := r.botDecision(1, c, BotNormal); a.Type == "pass" {
		t.Fatal("conceded the match with useful cards left")
	}
}

func TestBotMedicUsesDrawsChainsAndDryAgilePlacement(t *testing.T) {
	c, r := botFixture()
	r.Players[0].Hand = make([]Card, 3)
	r.Players[1].Hand = []Card{{UID: "medic", Def: 3}}
	r.Players[1].Grave = []Card{{UID: "strong", Def: 1}, {UID: "spy", Def: 2}}
	r.Players[1].Deck = []Card{{UID: "draw-a", Def: 1}, {UID: "draw-b", Def: 11}}
	if a := r.botDecision(1, c, BotNormal); a.Target != "spy" {
		t.Fatalf("ignored spy resurrection: %+v", a)
	}
	r.Players[1].Deck = nil
	r.Players[1].Grave = []Card{{UID: "strong", Def: 1}, {UID: "second-medic", Def: 18}}
	if a := r.botDecision(1, c, BotNormal); a.Target != "second-medic" {
		t.Fatalf("ignored Medic chain: %+v", a)
	}
	r.Weather = []string{"frost"}
	r.Players[1].Hand = []Card{{UID: "agile-medic", Def: 17}}
	r.Players[1].Grave = []Card{{UID: "agile", Def: 10}}
	if a := r.botDecision(1, c, BotHard); a.Row != "ranged" || a.TargetRow != "ranged" {
		t.Fatalf("revived into own frost: %+v", a)
	}
}

func TestBotWeatherEvaluatesBothSidesAndEmptyDeckSpy(t *testing.T) {
	c, r := botFixture()
	r.Weather = []string{"frost"}
	r.Players[0].Rows["close"] = []Card{{UID: "opponent", Def: 0}}
	r.Players[1].Rows["close"] = []Card{{UID: "strong", Def: 1}}
	r.Players[1].Hand = []Card{{UID: "clear", Def: 5}, {UID: "unit", Def: 1}}
	if a := r.botDecision(1, c, BotNormal); a.UID != "clear" {
		t.Fatalf("didn't clear harmful weather: %+v", a)
	}
	r.Players[1].Hand = []Card{{UID: "spy", Def: 2}, {UID: "unit", Def: 14}}
	if a := r.botDecision(1, c, BotNormal); a.UID != "unit" {
		t.Fatalf("valued an empty-deck spy as draw: %+v", a)
	}
}

func TestBotDoesNotDestroyItsLeadWithOnlyHarmfulWeatherAtMatchPoint(t *testing.T) {
	for _, level := range []BotDifficulty{BotNormal, BotHard} {
		c, r := botFixture()
		r.Round = 3
		r.Players[0].Wins, r.Players[1].Wins = 1, 1
		r.Players[0].Rows["ranged"] = []Card{{UID: "opponent", Def: 19}}
		r.Players[0].Hand = []Card{{UID: "unknown", Def: 0}}
		r.Players[1].Rows["close"] = []Card{{UID: "own", Def: 1}}
		r.Players[1].Hand = []Card{{UID: "self-harm-frost", Def: 6}}
		if a := r.botDecision(1, c, level); a.Type != "pass" {
			t.Fatalf("%s destroyed its winning position: %+v", level, a)
		}
	}
}

func TestBotDecisionsIgnoreHiddenCardsAndActualDrawOrder(t *testing.T) {
	c, r := botFixture()
	r.Players[0].Hand = []Card{{UID: "secret", Def: 13}}
	r.Players[0].Deck = []Card{{UID: "secret-deck", Def: 1}}
	r.Players[0].Rows["close"] = []Card{{UID: "public", Def: 1}}
	r.Players[1].Hand = []Card{{UID: "spy", Def: 2}, {UID: "medic", Def: 3}, {UID: "unit", Def: 1}}
	r.Players[1].Grave = []Card{{UID: "target", Def: 10}}
	r.Players[1].Deck = []Card{{UID: "a", Def: 0}, {UID: "b", Def: 11}, {UID: "c", Def: 16}}
	for _, level := range []BotDifficulty{BotNormal, BotHard} {
		before, _ := json.Marshal(r)
		want := r.botDecision(1, c, level)
		after, _ := json.Marshal(r)
		if string(before) != string(after) {
			t.Fatal("evaluation mutated authoritative state")
		}
		r.Players[0].Hand[0] = Card{UID: "different-secret", Def: 999999}
		r.Players[0].Deck[0] = Card{UID: "different-deck", Def: 999999}
		slices.Reverse(r.Players[1].Deck)
		if got := r.botDecision(1, c, level); !reflect.DeepEqual(want, got) {
			t.Fatalf("hidden data changed %s decision: %+v -> %+v", level, want, got)
		}
	}
}

func TestHardSearchUsesPublicHypothesesAndLeavesRoomUntouched(t *testing.T) {
	c := realCatalog(t)
	r := botArenaRoom(c, "realms", "nilfgaard", 71)
	r.Phase, r.Initiative, r.Turn = "turn", 0, 1
	r.randomState = 0
	before, _ := json.Marshal(r)
	want := r.botDecision(1, c, BotHard)
	after, _ := json.Marshal(r)
	if string(before) != string(after) {
		t.Fatal("hard search changed authoritative room")
	}
	for i := range r.Players[0].Hand {
		r.Players[0].Hand[i] = Card{UID: "private-hand", Def: 999999}
	}
	for i := range r.Players[0].Deck {
		r.Players[0].Deck[i] = Card{UID: "private-deck", Def: 999999}
	}
	r.Players[0].StartingDeck = []Card{{UID: "private-original-deck", Def: 999999}}
	slices.Reverse(r.Players[1].Deck)
	if got := r.botDecision(1, c, BotHard); !reflect.DeepEqual(want, got) {
		t.Fatalf("private cards changed hard search: %+v -> %+v", want, got)
	}
	position := r.botObservation(1)
	for sample := 0; sample < 3; sample++ {
		guess := position.botSampleOpponent(1, sample, c)
		if len(guess.Players[0].Hand) != len(r.Players[0].Hand) {
			t.Fatal("hypothesis changed observed hand count")
		}
		for _, card := range guess.Players[0].Hand {
			if card.Def < 0 || card.Def >= len(c) {
				t.Fatal("hypothesis read real hidden definitions")
			}
			d := c[card.Def]
			if d.Deck != "realms" && d.Deck != "neutral" && d.Deck != "special" && d.Deck != "weather" {
				t.Fatal("hypothesis invented a foreign-faction card")
			}
		}
	}
}

func BenchmarkBotDecision(b *testing.B) {
	c, r := botFixture()
	r.Players[0].Passed = true
	r.Players[0].Rows["close"] = []Card{{UID: "opponent", Def: 11}}
	r.Players[1].Hand = []Card{{UID: "a", Def: 1}, {UID: "b", Def: 16}, {UID: "c", Def: 11}, {UID: "medic", Def: 3}, {UID: "decoy", Def: 4}}
	r.Players[1].Grave = []Card{{UID: "d", Def: 1}, {UID: "spy", Def: 2}}
	r.Players[1].Deck = []Card{{UID: "e", Def: 1}, {UID: "f", Def: 16}}
	for _, level := range []BotDifficulty{BotNormal, BotHard} {
		b.Run(string(level), func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				r.botDecision(1, c, level)
			}
		})
	}
}
