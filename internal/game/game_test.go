package game

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

func Fixture() Catalog {
	c := Catalog{}
	for _, f := range Factions {
		c = append(c, Definition{Name: f + " leader", Deck: f, Row: "leader", Count: "1"})
		for i := 0; i < 30; i++ {
			row := []string{"close", "ranged", "siege"}[i%3]
			c = append(c, Definition{Name: fmt.Sprintf("%s soldier %d", f, i), Deck: f, Row: row, Strength: "5", Count: "1"})
		}
	}
	c = append(c, Definition{Name: "Decoy", Deck: "special", Ability: "decoy", Count: "2"})
	c = append(c, Definition{Name: "Frost", Deck: "weather", Ability: "frost", Count: "2"})
	c = append(c, Definition{Name: "Scorch", Deck: "special", Ability: "scorch", Count: "2"})
	return c
}
func TestParseLegacyCatalogue(t *testing.T) {
	src := `var card_dict = JSON.parse(
 '[ '
 + '{"name":"Commander\'s Horn","deck":"special","ability":"horn"}'
 + ',{"name":"Geralt","deck":"neutral","row":"close","strength":"15"}'
 + ']'
 );`
	c, err := ParseLegacyCards([]byte(src))
	if err != nil {
		t.Fatal(err)
	}
	if len(c) != 2 || c[0].Name != "Commander's Horn" || c[1].Power() != 15 {
		t.Fatalf("bad catalog: %+v", c)
	}
}
func TestBotAndSecrecy(t *testing.T) {
	c := Fixture()
	now := time.Unix(1_800_000_000, 0)
	r, err := NewRoom("ABCDEFGHJKLM", "bot", "alice-private-token", "Alice", "realms", c, now)
	if err != nil {
		t.Fatal(err)
	}
	if r.Status != "playing" || r.ExpiresAt.Sub(r.CreatedAt) != RoomLifetime || r.Phase != "mulligan" {
		t.Fatalf("bad state: %+v", r)
	}
	if len(r.Players[0].Hand) != 10 || len(r.Players[1].Hand) == 0 {
		t.Fatal("hands not dealt")
	}
	v := r.Project(0, c)
	if len(v.Players[1].Hand) > 0 || v.Players[1].HandCount == 0 {
		t.Fatal("opponent hand leaked or not counted")
	}
	body, _ := json.Marshal(v)
	if strings.Contains(string(body), "alice-private-token") || strings.Contains(string(body), `"deck":[`) {
		t.Fatal("private room data leaked")
	}
	if err := r.Apply(1, Action{Type: "pass"}, c); err == nil {
		t.Fatal("bot seat accepted from human")
	}
	if err := r.Apply(0, Action{Type: "play", UID: "fake", Row: "close"}, c); err == nil {
		t.Fatal("fake card accepted")
	}
	if err := r.Apply(0, Action{Type: "ready"}, c); err != nil {
		t.Fatal(err)
	}
	before := r.Version
	card := r.Players[0].Hand[0]
	row := c[card.Def].Row
	if c[card.Def].Deck == "special" || c[card.Def].Deck == "weather" {
		for _, x := range r.Players[0].Hand {
			if !c[x.Def].Has("decoy") && c[x.Def].Row != "" {
				card = x
				row = c[x.Def].Row
				break
			}
		}
	}
	if err := r.Apply(0, Action{Type: "play", UID: card.UID, Row: row}, c); err != nil {
		t.Fatal(err)
	}
	if r.Version <= before {
		t.Fatal("version not advanced")
	}
}
func TestPvpAndTurns(t *testing.T) {
	c := Fixture()
	r, err := NewRoom("ABCDEFGHJKLM", "pvp", "a", "Alice", "realms", c, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if r.Status != "waiting" {
		t.Fatal("room must wait")
	}
	if err := r.Join("b", "Bob", "monsters", c); err != nil {
		t.Fatal(err)
	}
	if r.Status != "playing" || len(r.Players) != 2 {
		t.Fatal("not started")
	}
	if err := r.Join("c", "Carol", "realms", c); err == nil {
		t.Fatal("third player joined")
	}
	if err := r.Apply(0, Action{Type: "ready"}, c); err != nil {
		t.Fatal(err)
	}
	if err := r.Apply(1, Action{Type: "ready"}, c); err != nil {
		t.Fatal(err)
	}
	mover := r.Turn
	other := 1 - mover
	if err := r.Apply(other, Action{Type: "pass"}, c); err == nil {
		t.Fatal("out of turn pass accepted")
	}
	if err := r.Apply(mover, Action{Type: "pass"}, c); err != nil {
		t.Fatal(err)
	}
	if r.Turn != other {
		t.Fatalf("wrong turn: %d", r.Turn)
	}
	if err := r.Apply(other, Action{Type: "pass"}, c); err != nil {
		t.Fatal(err)
	}
	if r.Round != 2 && r.Status != "finished" {
		t.Fatal("round didn't advance")
	}
}
func TestWeatherAndBond(t *testing.T) {
	c := Catalog{{Name: "Bonded", Deck: "realms", Row: "close", Strength: "4", Ability: "bond", Count: "2"}}
	r := &Room{Players: []Player{{Rows: rows(), Horn: map[string]bool{}}, {Rows: rows(), Horn: map[string]bool{}}}}
	r.Players[0].Rows["close"] = []Card{{UID: "a", Def: 0}, {UID: "b", Def: 0}}
	if s := r.Score(0, c); s != 16 {
		t.Fatalf("bond score = %d, want 16", s)
	}
	r.Weather = []string{"frost"}
	if s := r.Score(0, c); s != 4 {
		t.Fatalf("weather score = %d, want 4", s)
	}
}

func TestCardIDsDistinctAcrossPlayers(t *testing.T) {
	c := Fixture()
	room, err := NewRoom("ABCDEFGHJKLM", "pvp", "alice", "Alice", "realms", c, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := room.Join("bob", "Bob", "realms", c); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, p := range room.Players {
		for _, pile := range [][]Card{p.Deck, p.Hand} {
			for _, card := range pile {
				if seen[card.UID] {
					t.Fatalf("duplicate UID: %s", card.UID)
				}
				seen[card.UID] = true
			}
		}
	}
}
func TestScorchUsesCurrentPower(t *testing.T) {
	c := Catalog{
		{Name: "Strong base", Deck: "realms", Row: "close", Strength: "8", Count: "1"},
		{Name: "Bond", Deck: "realms", Row: "close", Strength: "5", Ability: "bond", Count: "2"},
	}
	r := &Room{Players: []Player{{Rows: rows(), Horn: map[string]bool{}}, {Rows: rows(), Horn: map[string]bool{}}}}
	r.Players[0].Rows["close"] = []Card{{UID: "base", Def: 0}}
	r.Players[1].Rows["close"] = []Card{{UID: "bond1", Def: 1}, {UID: "bond2", Def: 1}}
	// Each bonded card is strength 10, greater than the base card's 8.
	r.destroyStrongest(c, -1, "", 0)
	if len(r.Players[0].Rows["close"]) != 1 || len(r.Players[1].Rows["close"]) != 0 {
		t.Fatalf("scorch destroyed wrong cards: %+v", r.Players)
	}
}
func TestMardroemeTransformsCardsAddedLater(t *testing.T) {
	c := make(Catalog, 208)
	c[1] = Definition{Name: "Berserker", Row: "close", Strength: "4", Ability: "berserker"}
	c[206] = Definition{Name: "Bear", Row: "close", Strength: "14"}
	r := &Room{Players: []Player{{Rows: rows(), Mardroeme: map[string]bool{"close": true}}, {Rows: rows()}}}
	r.place(0, Card{UID: "berserker", Def: 1}, "close", c)
	if r.Players[0].Rows["close"][0].Def != 206 {
		t.Fatal("a late berserker did not transform")
	}
}
func TestMonsterRetainedAgileStaysOnOriginalRow(t *testing.T) {
	c := Catalog{{Name: "Agile", Row: "agile", Deck: "monsters", Strength: "5"}}
	r := &Room{Round: 1, Status: "playing", Players: []Player{
		{Faction: "monsters", Rows: rows(), Horn: map[string]bool{}, Mardroeme: map[string]bool{}},
		{Faction: "realms", Rows: rows(), Horn: map[string]bool{}, Mardroeme: map[string]bool{}},
	}}
	r.Players[0].Rows["ranged"] = []Card{{UID: "agile", Def: 0}}
	r.Players[0].Passed = true
	r.Players[1].Passed = true
	r.finishRound(c)
	if len(r.Players[0].Rows["ranged"]) != 1 || len(r.Players[0].Rows["close"]) != 0 {
		t.Fatalf("retained agile moved rows: %+v", r.Players[0].Rows)
	}
}

func TestProjectedCardPowerMatchesBoard(t *testing.T) {
	c := Catalog{{Name: "Bond", Deck: "realms", Row: "close", Strength: "5", Ability: "bond"}}
	room := &Room{Players: []Player{{Rows: rows(), Horn: map[string]bool{}}, {Rows: rows()}}, Weather: []string{"frost"}}
	room.Players[0].Rows["close"] = []Card{{UID: "x", Def: 0}, {UID: "y", Def: 0}}
	v := room.Project(0, c)
	if v.Players[0].Score != 4 || v.Players[0].Rows["close"][0].Power != 2 {
		t.Fatalf("client sees incorrect card strength: %+v", v.Players[0])
	}
}

func TestSelectAndActivateLeader(t *testing.T) {
	c := Fixture()
	// Fixture starts with the Northern Realms leader at catalogue ID 1.
	c[0].Ability = "foltest_lord"
	r, err := NewRoom("ABCDEFGHJKLM", "pvp", "alice", "Alice", "realms", c, time.Now(), 1)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Join("bob", "Bob", "nilfgaard", c); err != nil {
		t.Fatal(err)
	}
	if err := r.Apply(0, Action{Type: "ready"}, c); err != nil {
		t.Fatal(err)
	}
	if err := r.Apply(1, Action{Type: "ready"}, c); err != nil {
		t.Fatal(err)
	}
	r.Turn = 0
	r.Weather = []string{"frost"}
	if err := r.Apply(0, Action{Type: "leader"}, c); err != nil {
		t.Fatal(err)
	}
	if len(r.Weather) != 0 || !r.Players[0].LeaderUsed {
		t.Fatal("leader did not clear weather")
	}
	if err := r.Apply(0, Action{Type: "leader"}, c); err == nil {
		t.Fatal("leader used twice")
	}
	if _, err := NewRoom("ABCDEFGHJKLM", "pvp", "malice", "M", "realms", c, time.Now(), 32); err == nil {
		t.Fatal("leader from another faction accepted")
	}
	options := LeaderOptions(c)
	if len(options) != 1 || options[0].Ability != "foltest_lord" {
		t.Fatalf("unexpected leaders %+v", options)
	}
}
func TestKingBranWeatherProtection(t *testing.T) {
	c := Catalog{{Name: "Bran", Deck: "skellige", Row: "leader", Ability: "king_bran"}, {Name: "Unit", Deck: "skellige", Row: "close", Strength: "7"}}
	r := &Room{Players: []Player{{Leader: 1, Rows: rows(), Horn: map[string]bool{}}, {Rows: rows()}}, Weather: []string{"frost"}}
	r.Players[0].Rows["close"] = []Card{{UID: "unit", Def: 1}}
	if power := r.Score(0, c); power != 3 {
		t.Fatalf("king bran got %d want 3", power)
	}
}

func customFixtureDeck(c Catalog, faction string) []DeckEntry {
	out := []DeckEntry{}
	for i, d := range c {
		if d.Deck == faction && d.Row != "leader" && d.Copies() > 0 {
			out = append(out, DeckEntry{Def: i, Count: 1})
			if len(out) == 22 {
				return out
			}
		}
	}
	return out
}
func TestBotLevelsAndDeckModes(t *testing.T) {
	c := Fixture()
	for _, level := range []BotDifficulty{BotEasy, BotNormal, BotHard} {
		for _, mode := range []BotDeckMode{BotRandom, BotFaction, BotCustom} {
			opts := BotOptions{Difficulty: level, DeckMode: mode}
			if mode != BotRandom {
				opts.Faction = "skellige"
			}
			if mode == BotCustom {
				opts.Deck = customFixtureDeck(c, "skellige")
			}
			r, err := NewRoomConfigured("ABCDEFGHJKLM", "bot", "alice", "Alice", "realms", c, time.Now(), 0, opts)
			if err != nil {
				t.Fatalf("%s / %s: %v", level, mode, err)
			}
			if r.Bot == nil || r.Bot.Difficulty != level || r.Bot.DeckMode != mode || r.Players[1].Faction != r.Bot.Faction {
				t.Fatalf("wrong bot config: %+v", r.Bot)
			}
			v := r.Project(0, c)
			if v.Bot == nil || len(v.Players[1].Hand) != 0 || v.Bot.Difficulty != level {
				t.Fatalf("bot secret leaked: %+v", v)
			}
			if mode == BotCustom {
				count := 0
				for _, p := range r.Players {
					for _, pile := range [][]Card{p.Hand, p.Deck, p.Grave, p.Rows["close"], p.Rows["ranged"], p.Rows["siege"]} {
						for _, card := range pile {
							if c[card.Def].Deck == "skellige" {
								count++
							}
						}
					}
				}
				if count != 22 {
					t.Fatalf("custom deck changed after start: %d cards", count)
				}
			}
		}
	}
}
func TestCustomDeckValidationRejectsExploits(t *testing.T) {
	c := Fixture()
	valid := customFixtureDeck(c, "realms")
	cases := []struct {
		name    string
		faction string
		deck    []DeckEntry
	}{
		{"valid", "realms", valid},
		{"too few units", "realms", valid[:21]},
		{"foreign faction", "monsters", valid},
		{"duplicate definition", "realms", append(append([]DeckEntry{}, valid...), valid[0])},
		{"too many copies", "realms", append([]DeckEntry{{Def: valid[0].Def, Count: 99}}, valid[1:]...)},
		{"leader in deck", "realms", append(append([]DeckEntry{}, valid...), DeckEntry{Def: 0, Count: 1})},
		{"negative id", "realms", append(append([]DeckEntry{}, valid...), DeckEntry{Def: -1, Count: 1})},
	}
	for _, tt := range cases {
		err := ValidateDeck(c, tt.faction, tt.deck)
		if (err == nil) != (tt.name == "valid") {
			t.Errorf("%s: expected valid iff named valid, got %v", tt.name, err)
		}
	}
	opts := BotOptions{Difficulty: BotHard, DeckMode: BotCustom, Faction: "realms", Deck: valid[:21]}
	if _, err := NewRoomConfigured("ABCDEFGHJKLM", "bot", "a", "A", "realms", c, time.Now(), 0, opts); err == nil {
		t.Fatal("invalid deck accepted at room creation")
	}
	for _, difficulty := range []BotDifficulty{"expert", "", BotNormal} {
		o := BotOptions{Difficulty: difficulty, DeckMode: BotFaction, Faction: "realms"}
		_, err := o.normalize()
		if (err == nil) != (difficulty != "expert") {
			t.Fatalf("difficulty %q check failed: %v", difficulty, err)
		}
	}
}
func TestHardBotEvaluatesWithoutMutatingState(t *testing.T) {
	c := Fixture()
	r, err := NewRoomConfigured("ABCDEFGHJKLM", "bot", "a", "A", "realms", c, time.Now(), 0, BotOptions{Difficulty: BotHard, DeckMode: BotFaction, Faction: "nilfgaard"})
	if err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(r)
	candidates := r.botChoices(c)
	for _, candidate := range candidates {
		_, _ = r.botChoiceScore(candidate, c, BotHard)
	}
	after, _ := json.Marshal(r)
	if string(before) != string(after) {
		t.Fatal("bot evaluation mutated authoritative game state")
	}
}

func TestCustomPlayerDeckIsRespected(t *testing.T) {
	catalog := Fixture()
	starter, err := addPlayer("player", "Alice", "realms", catalog)
	if err != nil {
		t.Fatal(err)
	}
	counts := map[int]int{}
	for _, card := range starter.Deck {
		counts[card.Def]++
	}
	selected := []DeckEntry{}
	for id, count := range counts {
		selected = append(selected, DeckEntry{Def: id, Count: count})
	}
	if err := ValidateDeck(catalog, "realms", selected); err != nil {
		t.Fatal(err)
	}
	room, err := NewRoomWithDeck("QWERTYUIOPAS", "bot", "player", "Alice", "realms", catalog, time.Now(), 0, botDefaults(), selected)
	if err != nil {
		t.Fatal(err)
	}
	for _, card := range append(append([]Card{}, room.Players[0].Hand...), room.Players[0].Deck...) {
		counts[card.Def]--
	}
	for id, count := range counts {
		if count != 0 {
			t.Fatalf("custom card %d mismatch by %d", id, count)
		}
	}
	invalid := append([]DeckEntry{}, selected...)
	invalid[0].Count = 999
	if _, err := NewRoomWithDeck("QWERTYUIOPAS", "bot", "player", "Alice", "realms", catalog, time.Now(), 0, botDefaults(), invalid); err == nil {
		t.Fatal("invalid custom deck accepted")
	}
}
