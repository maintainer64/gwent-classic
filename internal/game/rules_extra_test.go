package game

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"
)

func manualRoom() (*Room, Catalog) {
	c := Fixture()
	mk := func(name string) Player {
		return Player{ID: name, Name: name, Faction: "realms", Rows: rows(), Special: rows(), Horn: map[string]bool{}, Mardroeme: map[string]bool{}}
	}
	return &Room{Status: "playing", Turn: 0, Round: 1, Winner: -1, Players: []Player{mk("Alice"), mk("Bob")}}, c
}
func appendCard(c *Catalog, name, row, ability string, power int) Card {
	id := len(*c)
	*c = append(*c, Definition{Name: name, Deck: "realms", Row: row, Ability: ability, Strength: strconv.Itoa(power), Count: "1"})
	return Card{UID: strings.ReplaceAll(name, " ", "_"), Def: id}
}
func TestDecoyReallyReplacesUnit(t *testing.T) {
	r, c := manualRoom()
	unit := appendCard(&c, "Captured spy", "ranged", "spy", 5)
	decoy := Card{UID: "decoy", Def: c.Find("Decoy")}
	r.Players[0].Rows["ranged"] = []Card{unit}
	r.Players[0].Hand = []Card{decoy}
	if err := r.play(0, Action{UID: decoy.UID, Target: unit.UID}, c); err != nil {
		t.Fatal(err)
	}
	if len(r.Players[0].Hand) != 1 || r.Players[0].Hand[0].UID != unit.UID {
		t.Fatal("returned card must be in hand")
	}
	if len(r.Players[0].Rows["ranged"]) != 1 || r.Players[0].Rows["ranged"][0].UID != decoy.UID {
		t.Fatal("decoy must stay on board until round ends")
	}
	if len(r.Players[0].Grave) != 0 {
		t.Fatal("decoy is not immediately discarded")
	}
}
func TestMedicRevivalSelectionAndValidation(t *testing.T) {
	r, c := manualRoom()
	medic := appendCard(&c, "Healer", "close", "medic", 5)
	a := appendCard(&c, "weak unit", "close", "", 3)
	b := appendCard(&c, "strong unit", "siege", "", 8)
	r.Players[0].Hand = []Card{medic}
	r.Players[0].Grave = []Card{a, b}
	if err := r.play(0, Action{UID: medic.UID, Row: "close", Target: "stolen"}, c); err == nil {
		t.Fatal("invalid target accepted")
	}
	if len(r.Players[0].Hand) != 1 {
		t.Fatal("invalid action mutated state")
	}
	if err := r.play(0, Action{UID: medic.UID, Row: "close", Target: b.UID}, c); err != nil {
		t.Fatal(err)
	}
	if len(r.Players[0].Grave) != 1 || r.Players[0].Grave[0].UID != a.UID {
		t.Fatal("wrong grave target revived")
	}
	if len(r.Players[0].Rows["siege"]) != 1 || r.Players[0].Rows["siege"][0].UID != b.UID {
		t.Fatal("chosen unit must return to its printed row")
	}
}
func TestHornIsOnBoardThenInGrave(t *testing.T) {
	r, c := manualRoom()
	horn := appendCard(&c, "Horn", "", "horn", 0)
	c[horn.Def].Deck = "special"
	horn2 := Card{UID: "another", Def: horn.Def}
	r.Players[0].Hand = []Card{horn, horn2}
	if err := r.play(0, Action{UID: horn.UID, Row: "siege"}, c); err != nil {
		t.Fatal(err)
	}
	if len(r.Players[0].Special["siege"]) != 1 || len(r.Players[0].Grave) != 0 {
		t.Fatal("horn must occupy row")
	}
	if err := r.play(0, Action{UID: horn2.UID, Row: "siege"}, c); err == nil {
		t.Fatal("double special on same row")
	}
	r.Players[0].Passed = true
	r.Players[1].Passed = true
	r.finishRound(c)
	if len(r.Players[0].Special["siege"]) != 0 || len(r.Players[0].Grave) != 1 {
		t.Fatal("horn must be discarded on next round")
	}
}
func TestAvengerSummonsAfterDestruction(t *testing.T) {
	r, c := manualRoom()
	cow := appendCard(&c, "Cow", "ranged", "avenger", 0)
	defender := appendCard(&c, "defender", "ranged", "", 5)
	summoned := appendCard(&c, "Bovine Defense Force", "close", "", 8)
	_ = summoned
	r.Players[0].Rows["ranged"] = []Card{cow}
	r.Players[1].Rows["ranged"] = []Card{defender}
	r.removeUnit(0, cow, "ranged", c)
	if len(r.Players[0].Rows["close"]) != 1 || r.Players[0].Rows["close"][0].Def != c.Find("Bovine Defense Force") {
		t.Fatal("replacement not summoned")
	}
}
func TestNoOpponentSecretsInProjection(t *testing.T) {
	r, c := manualRoom()
	hand := appendCard(&c, "secret unit", "close", "", 5)
	r.Players[1].Hand = []Card{hand}
	r.Players[1].Deck = []Card{hand}
	r.Players[1].Peek = []Card{hand}
	v := r.Project(0, c)
	if len(v.Players[1].Hand) > 0 || len(v.Players[1].DeckChoices) > 0 || len(v.Players[1].Peek) > 0 {
		t.Fatal("opponent secrets exposed")
	}
	raw, _ := json.Marshal(v)
	if strings.Contains(string(raw), "secret unit") {
		t.Fatal("private card appears in projected JSON")
	}
}
func TestLeaderGraveSelectionAndPeek(t *testing.T) {
	r, c := manualRoom()
	leader := appendCard(&c, "Emhyr", "leader", "emhyr_relentless", 0)
	r.Players[0].Leader = leader.Def + 1
	unit := appendCard(&c, "prisoner", "close", "", 5)
	r.Players[1].Grave = []Card{unit}
	if err := r.activateLeader(0, Action{Type: "leader", Target: "invalid"}, c); err == nil {
		t.Fatal("invalid opposing discard target accepted")
	}
	if r.Players[0].LeaderUsed {
		t.Fatal("failed ability consumed leader")
	}
	if err := r.activateLeader(0, Action{Type: "leader", Target: unit.UID}, c); err != nil {
		t.Fatal(err)
	}
	if len(r.Players[0].Hand) != 1 || len(r.Players[1].Grave) != 0 {
		t.Fatal("leader failed to steal card")
	}
}

func TestScoiataelInitiativeIsAuthorizedOnce(t *testing.T) {
	r, c := manualRoom()
	r.Players[0].Faction = "scoiatael"
	r.Players[1].Faction = "realms"
	r.Initiative = 1
	r.Turn = 1
	if err := r.Apply(1, Action{Type: "initiative", Target: "self"}, c); err == nil {
		t.Fatal("other player chose initiative")
	}
	if err := r.Apply(0, Action{Type: "pass"}, c); err == nil {
		t.Fatal("skipped faction choice")
	}
	if err := r.Apply(0, Action{Type: "initiative", Target: "self"}, c); err != nil {
		t.Fatal(err)
	}
	if r.Turn != 0 || r.Initiative != 0 {
		t.Fatal("scoiatael must receive first turn")
	}
	if last := r.Transitions[len(r.Transitions)-1]; last.Type != "round_start" || last.Actor != 0 {
		t.Fatal("initiative must announce the selected first player")
	}
	if err := r.Apply(0, Action{Type: "initiative", Target: "opponent"}, c); err == nil {
		t.Fatal("initiative repeated")
	}
}
func TestOldSerializedRoomHasNoInitiativePrompt(t *testing.T) {
	var r Room
	if err := json.Unmarshal([]byte(`{"status":"playing","turn":0}`), &r); err != nil {
		t.Fatal(err)
	}
	if r.Initiative != 0 {
		t.Fatal("old persisted rooms should not be blocked")
	}
}

func TestInitialMulliganIsPrivateAndSynchronized(t *testing.T) {
	c := Fixture()
	room, err := NewRoom("ABCDEFGHIJKL", "pvp", "alice", "Alice", "realms", c, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := room.Join("bob", "Bob", "nilfgaard", c); err != nil {
		t.Fatal(err)
	}
	if room.Phase != "mulligan" || room.Players[0].Redraws != 2 || room.Players[1].Redraws != 2 {
		t.Fatal("missing opening redraw phase")
	}
	target := room.Players[0].Hand[0]
	if err := room.Apply(1, Action{Type: "redraw", UID: target.UID}, c); err == nil {
		t.Fatal("opponent discarded a private card")
	}
	if err := room.Apply(room.Turn, Action{Type: "pass"}, c); err == nil {
		t.Fatal("play before redraw complete")
	}
	if err := room.Apply(0, Action{Type: "redraw", UID: target.UID}, c); err != nil {
		t.Fatal(err)
	}
	for _, card := range room.Players[0].Hand {
		if card.UID == target.UID {
			t.Fatal("redrawn card returned immediately")
		}
	}
	if room.Players[0].Redraws != 1 {
		t.Fatal("redraw not counted")
	}
	if err := room.Apply(0, Action{Type: "ready"}, c); err != nil {
		t.Fatal(err)
	}
	if room.Phase != "mulligan" {
		t.Fatal("match started before second player was ready")
	}
	if err := room.Apply(1, Action{Type: "ready"}, c); err != nil {
		t.Fatal(err)
	}
	if room.Phase != "turn" {
		t.Fatal("match did not start after both ready")
	}
	if last := room.Transitions[len(room.Transitions)-1]; last.Type != "round_start" || last.Actor != room.Turn {
		t.Fatal("opening round must announce the first player after both are ready")
	}
}

func TestSecondRedrawAutomaticallyReadiesBothPlayers(t *testing.T) {
	c := Fixture()
	r, err := NewRoom("ABCDEFGHIJKL", "pvp", "alice", "Alice", "realms", c, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Join("bob", "Bob", "nilfgaard", c); err != nil {
		t.Fatal(err)
	}
	for seat := 0; seat < 2; seat++ {
		for n := 0; n < 2; n++ {
			if err := r.Apply(seat, Action{Type: "redraw", UID: r.Players[seat].Hand[0].UID}, c); err != nil {
				t.Fatal(err)
			}
			if n == 0 && r.Players[seat].Ready {
				t.Fatal("first redraw readied player too early")
			}
		}
		if !r.Players[seat].Ready || r.Players[seat].Redraws != 0 {
			t.Fatal("second redraw must ready the player")
		}
		if seat == 0 && r.Phase != "mulligan" {
			t.Fatal("must wait for the opponent to finish preparing")
		}
	}
	if r.Phase != "turn" {
		t.Fatal("both finished redraws but opening round did not start")
	}
	starts := 0
	for _, event := range r.Transitions {
		if event.Type == "round_start" {
			starts++
		}
	}
	if starts != 1 {
		t.Fatalf("opening round must start once, got %d announcements", starts)
	}
}

func TestChainedMedicRequiresSecondChoiceAndDoesNotSkipTurn(t *testing.T) {
	r, c := manualRoom()
	first := appendCard(&c, "initial medic", "close", "medic", 5)
	second := appendCard(&c, "grave medic", "ranged", "medic", 5)
	third := appendCard(&c, "rescued unit", "siege", "", 6)
	r.Players[0].Hand = []Card{first}
	// The opponent still has a legal action after the chained Medic resolves.
	r.Players[1].Hand = []Card{{UID: "opponent-hand", Def: c.Find("realms soldier 0")}}
	r.Players[0].Grave = []Card{second, third}
	if err := r.Apply(0, Action{Type: "play", UID: first.UID, Row: "close", Target: second.UID}, c); err != nil {
		t.Fatal(err)
	}
	if r.PendingOwner != 1 || r.Turn != 0 {
		t.Fatal("medic chain must not end the turn")
	}
	if err := r.Apply(1, Action{Type: "revive", Target: third.UID}, c); err == nil {
		t.Fatal("opponent completed another player's chain")
	}
	if err := r.Apply(0, Action{Type: "pass"}, c); err == nil {
		t.Fatal("cannot interrupt pending medic")
	}
	if err := r.Apply(0, Action{Type: "revive", Target: third.UID}, c); err != nil {
		t.Fatal(err)
	}
	if r.PendingOwner != 0 || r.Turn != 1 {
		t.Fatal("turn was not completed after the last Medic")
	}
	if len(r.Players[0].Rows["siege"]) != 1 {
		t.Fatal("chain did not revive the selected unit")
	}
}

func TestRevivedSpyCountsForOpponentAndDrawsForOwner(t *testing.T) {
	r, c := manualRoom()
	spy := appendCard(&c, "infiltrator", "close", "spy", 4)
	r.Players[0].Grave = []Card{spy}
	draw := appendCard(&c, "draw reward", "siege", "", 6)
	r.Players[0].Deck = []Card{draw}
	r.reviveTarget(0, spy.UID, c)
	if len(r.Players[1].Rows["close"]) != 1 || len(r.Players[0].Rows["close"]) != 0 {
		t.Fatal("spy belongs on enemy board")
	}
	if len(r.Players[0].Hand) != 1 || r.Players[0].Hand[0].UID != draw.UID {
		t.Fatal("spy must draw for its owner")
	}
}

// Ported directly from the original JS Row.calcCardScore pipeline.
// These tests lock down modifier order instead of only asserting total score.
func TestOriginalScoreOrderMoraleBeforeHorn(t *testing.T) {
	r, c := manualRoom()
	unit := appendCard(&c, "footman", "close", "", 5)
	morale := appendCard(&c, "trumpeter", "close", "morale", 5)
	r.Players[0].Rows["close"] = []Card{unit, morale}
	r.Players[0].Horn["close"] = true
	// Footman (5+1)*2 = 12, trumpeter (5+0)*2 = 10.
	if got := r.Score(0, c); got != 22 {
		t.Fatalf("morale must apply before horn: got %d, want 22", got)
	}
}
func TestOriginalScorchNeverHitsDecoy(t *testing.T) {
	r, c := manualRoom()
	decoy := Card{UID: "decoy", Def: c.Find("Decoy")}
	strong := appendCard(&c, "strong", "close", "", 5)
	c[strong.Def].Strength = "10"
	r.Players[0].Rows["close"] = []Card{decoy, strong}
	if got := r.Score(0, c); got != 10 {
		t.Fatalf("decoy must add no points: %d", got)
	}
	r.destroyStrongest(c, -1, "", 0)
	if len(r.Players[0].Rows["close"]) != 1 || r.Players[0].Rows["close"][0].UID != "decoy" {
		t.Fatal("scorch must ignore decoy")
	}
	r.Players[0].Hand = []Card{{UID: "second", Def: decoy.Def}}
	if err := r.play(0, Action{UID: "second", Target: "decoy"}, c); err == nil {
		t.Fatal("decoy cannot replace decoy")
	}
}
func TestOriginalWeatherSpyBondAndHornOrder(t *testing.T) {
	r, c := manualRoom()
	wolf := appendCard(&c, "wolf", "close", "spy bond", 5)
	c[wolf.Def].Strength = "7"
	leader := appendCard(&c, "Eredin", "leader", "eredin_treacherous", 0)
	r.Players[0].Leader = leader.Def + 1
	r.Players[0].Rows["close"] = []Card{wolf, {UID: "otherwolf", Def: wolf.Def}}
	r.Players[0].Horn["close"] = true
	r.Weather = []string{"frost"}
	// Original: weather 1 -> double spy 2 -> bond x2 4 -> horn x2 8, each.
	if got := r.Score(0, c); got != 16 {
		t.Fatalf("modifier order got %d, want 16", got)
	}
}
func TestOriginalHornUnitsDoubleOtherHornUnits(t *testing.T) {
	r, c := manualRoom()
	hornUnit := appendCard(&c, "hornBearer", "close", "horn", 5)
	r.Players[0].Rows["close"] = []Card{hornUnit, {UID: "secondhorn", Def: hornUnit.Def}}
	if got := r.Score(0, c); got != 20 {
		t.Fatalf("two horn units should double each other, got %d", got)
	}
}
func TestOriginalRoundWinnerStartsNextRound(t *testing.T) {
	r, c := manualRoom()
	a := appendCard(&c, "winning unit", "close", "", 5)
	r.Players[0].Rows["close"] = []Card{a}
	r.Turn = 1 // loser passed last: should NOT determine next round
	r.Players[0].Passed = true
	r.Players[1].Passed = true
	r.finishRound(c)
	if r.Round != 2 || r.Turn != 0 {
		t.Fatalf("round winner must start round two: round %d turn %d", r.Round, r.Turn)
	}
}

func TestOriginalWeatherRowCardOwnershipAndDuplicates(t *testing.T) {
	r, c := manualRoom()
	frost := appendCard(&c, "Biting Frost", "", "frost", 0)
	c[frost.Def].Deck = "weather"
	other := Card{UID: "duplicate", Def: frost.Def}
	r.playWeather(0, frost, c)
	if len(r.WeatherCards) != 1 || len(r.Players[0].Grave) != 0 || len(r.Weather) != 1 {
		t.Fatal("weather must occupy weather row")
	}
	r.playWeather(1, other, c)
	if len(r.WeatherCards) != 1 || len(r.Players[1].Grave) != 1 || len(r.Weather) != 1 {
		t.Fatal("duplicate weather goes immediately into the original owner's grave")
	}
	r.clearWeather()
	if len(r.WeatherCards) != 0 || len(r.Weather) != 0 || len(r.Players[0].Grave) != 1 || r.Players[0].Grave[0].UID != frost.UID {
		t.Fatal("cleared weather did not return to the right owner's grave")
	}
}

func TestOriginalDrawPreservesStartingPlayer(t *testing.T) {
	r, c := manualRoom()
	r.RoundStarter = 0
	r.Turn = 1
	r.Players[0].Passed = true
	r.Players[1].Passed = true
	r.finishRound(c)
	if r.Round != 2 || r.Turn != 0 {
		t.Fatalf("tied round must keep previous opener: got %d", r.Turn)
	}
}

// Matrix regression derived from the original JavaScript Row.calcCardScore,
// independently applying each step to lock modifier order and exclusions.
func TestOriginalCardScoreModifierMatrix(t *testing.T) {
	for flags := 0; flags < 256; flags++ {
		r, c := manualRoom()
		weather := flags&1 != 0
		bran := flags&2 != 0
		spy := flags&4 != 0
		bond := flags&8 != 0
		horn := flags&16 != 0
		morale := flags&32 != 0
		hero := flags&64 != 0
		doubleSpy := flags&128 != 0
		ability := ""
		if spy {
			ability += " spy"
		}
		if bond {
			ability += " bond"
		}
		if hero {
			ability += " hero"
		}
		card := appendCard(&c, "test soldier", "close", ability, 7)
		c[card.Def].Strength = "7"
		r.Players[0].Rows["close"] = []Card{card}
		groupCount := 1
		if bond {
			r.Players[0].Rows["close"] = append(r.Players[0].Rows["close"], Card{UID: "second", Def: card.Def})
			groupCount = 2
		}
		if weather {
			r.Weather = []string{"frost"}
		}
		if horn {
			r.Players[0].Horn["close"] = true
		}
		moraleCount := 0
		if morale {
			m := appendCard(&c, "morale", "close", "morale", 4)
			c[m.Def].Strength = "4"
			r.Players[0].Rows["close"] = append(r.Players[0].Rows["close"], m)
			moraleCount = 1
		}
		if bran {
			leader := appendCard(&c, "Bran", "leader", "king_bran", 0)
			r.Players[0].Leader = leader.Def + 1
		}
		if doubleSpy {
			leader := appendCard(&c, "Treacherous", "leader", "eredin_treacherous", 0)
			r.Players[1].Leader = leader.Def + 1
		}
		expected := 7
		if !hero {
			if weather {
				limit := 1
				if bran {
					limit = expected / 2
				}
				if expected > limit {
					expected = limit
				}
			}
			if spy && doubleSpy {
				expected *= 2
			}
			if bond {
				expected *= groupCount
			}
			expected += moraleCount
			if horn {
				expected *= 2
			}
		}
		got := r.unitPowers(0, "close", c)[card.UID]
		if got != expected {
			t.Fatalf("original score discrepancy flags %08b: got %d expected %d", flags, got, expected)
		}
	}
}

func TestWhiteFlameCancelsBothLeaderPowers(t *testing.T) {
	r, c := manualRoom()
	whiteFlame := appendCard(&c, "Emhyr White Flame", "leader", "emhyr_whiteflame", 0)
	bran := appendCard(&c, "Bran", "leader", "king_bran", 0)
	r.Players[0].Leader = whiteFlame.Def + 1
	r.Players[1].Leader = bran.Def + 1
	if !r.leadersNullified(c) || r.leaderHas(1, c, "king_bran") {
		t.Fatal("White Flame must also cancel passive leader powers")
	}
	r.Weather = []string{"frost"}
	unit := appendCard(&c, "test unit", "close", "", 7)
	c[unit.Def].Strength = "7"
	r.Players[1].Rows["close"] = []Card{unit}
	if got := r.Score(1, c); got != 1 {
		t.Fatalf("Bran should be disabled: got %d", got)
	}
	if err := r.activateLeader(1, Action{Type: "leader"}, c); err == nil {
		t.Fatal("White Flame must cancel active powers, too")
	}
	r.start(c)
	if !r.Players[0].LeaderUsed || !r.Players[1].LeaderUsed {
		t.Fatal("both leaders should be unavailable from game start")
	}
}

func TestOriginalMusterPrefixAndChain(t *testing.T) {
	r, c := manualRoom()
	arachas := appendCard(&c, "Arachas- Behemoth", "close", "muster", 6)
	c[arachas.Def].Strength = "6"
	arachas2 := appendCard(&c, "Arachas ", "close", "muster", 4)
	arachas3 := appendCard(&c, "Arachas regular variant", "close", "", 3)
	r.Players[0].Hand = []Card{arachas, arachas2}
	r.Players[0].Deck = []Card{arachas3}
	if err := r.play(0, Action{UID: arachas.UID, Row: "close"}, c); err != nil {
		t.Fatal(err)
	}
	if len(r.Players[0].Rows["close"]) != 3 || len(r.Players[0].Hand) != 0 || len(r.Players[0].Deck) != 0 {
		t.Fatalf("Muster must summon whole prefix group, including Behemoth, got %v", r.Players[0].Rows["close"])
	}
}
func TestOriginalErmionHeroTransformsBerserkers(t *testing.T) {
	r, c := manualRoom()
	for len(c) < 208 {
		c = append(c, Definition{Name: "dummy"})
	}
	c[206] = Definition{Name: "Transformed Vildkaarl", Row: "close", Strength: "14", Ability: "vildkarrl morale"}
	c[207] = Definition{Name: "Transformed Young Vildkaarl", Row: "ranged", Strength: "8", Ability: "vildkarrl bond"}
	berserker := appendCard(&c, "Young Berserker", "ranged", "berserker", 2)
	ermion := appendCard(&c, "Ermion", "ranged", "hero mardroeme", 8)
	r.Players[0].Rows["ranged"] = []Card{berserker}
	r.Players[0].Hand = []Card{ermion}
	if err := r.play(0, Action{UID: ermion.UID, Row: "ranged"}, c); err != nil {
		t.Fatal(err)
	}
	if !r.Players[0].Mardroeme["ranged"] || r.Players[0].Rows["ranged"][0].Def != 207 {
		t.Fatal("Ermion hero must transform existing Berserkers")
	}
	another := appendCard(&c, "second Young Berserker", "ranged", "berserker", 2)
	r.place(0, another, "ranged", c)
	if r.Players[0].Rows["ranged"][2].Def != 207 {
		t.Fatal("Ermion must transform subsequently played Berserkers")
	}
}

func TestOriginalRoundScoreHistoryIsImmutable(t *testing.T) {
	r, c := manualRoom()
	unit := appendCard(&c, "champion", "close", "", 5)
	c[unit.Def].Strength = "9"
	r.Players[0].Rows["close"] = []Card{unit}
	r.Players[0].Passed = true
	r.Players[1].Passed = true
	r.finishRound(c)
	if len(r.RoundHistory) != 1 || r.RoundHistory[0].ScoreA != 9 || r.RoundHistory[0].ScoreB != 0 || r.RoundHistory[0].Winner != 0 {
		t.Fatalf("original score screen needs the immutable round totals: %+v", r.RoundHistory)
	}
	if len(r.Players[0].Rows["close"]) != 0 {
		t.Fatal("round board must be cleared after recording scores")
	}
	view := r.Project(0, c)
	if len(view.RoundHistory) != 1 || view.RoundHistory[0].ScoreA != 9 {
		t.Fatal("round result must survive projection")
	}
}
func TestProjectedDeckCompositionDoesNotExposeDrawOrder(t *testing.T) {
	r, c := manualRoom()
	first := appendCard(&c, "first", "close", "", 3)
	second := appendCard(&c, "second", "close", "", 6)
	r.Players[0].Deck = []Card{second, first}
	view := r.Project(0, c)
	if len(view.Players[0].DeckChoices) != 2 || view.Players[0].DeckChoices[0].Def != first.Def || view.Players[0].DeckChoices[1].Def != second.Def {
		t.Fatal("deck view must be sorted independently of hidden draw order")
	}
	if len(r.Players[0].Deck) != 2 || r.Players[0].Deck[0].UID != second.UID {
		t.Fatal("projection must never reshuffle the authoritative deck")
	}
	if len(view.Players[1].DeckChoices) != 0 {
		t.Fatal("opponent must not see private deck choices")
	}
}

func TestFrancescaHopeMatchesExhaustiveOptimalAgilePlacement(t *testing.T) {
	r, c := manualRoom()
	a := appendCard(&c, "Agile Archer", "agile", "bond", 4)
	b := appendCard(&c, "Agile Medic", "agile", "morale", 3)
	d := appendCard(&c, "Agile Scout", "agile", "", 7)
	c[a.Def].Strength = "4"
	c[b.Def].Strength = "3"
	c[d.Def].Strength = "7"
	agile := []Card{a, {UID: "second Archer", Def: a.Def}, b, d}
	r.Players[0].Rows["close"] = []Card{a, b}
	r.Players[0].Rows["ranged"] = []Card{agile[1], d}
	r.Players[0].Horn["close"] = true
	r.Weather = []string{"fog"}
	referenceMax := -1
	for mask := 0; mask < 1<<len(agile); mask++ {
		r.Players[0].Rows["close"] = nil
		r.Players[0].Rows["ranged"] = nil
		for i, card := range agile {
			row := "close"
			if mask&(1<<i) != 0 {
				row = "ranged"
			}
			r.Players[0].Rows[row] = append(r.Players[0].Rows[row], card)
		}
		if score := r.Score(0, c); score > referenceMax {
			referenceMax = score
		}
	}
	r.Players[0].Rows["close"] = []Card{a, b}
	r.Players[0].Rows["ranged"] = []Card{agile[1], d}
	r.optimalAgile(0, c)
	if got := r.Score(0, c); got != referenceMax {
		t.Fatalf("Francesca must find global optimum: got %d want %d", got, referenceMax)
	}
}

// The legacy Scorch ability also destroys zero-strength units when all
// non-hero combat units score 0 (e.g. the Cow). It is not a no-op.
func TestScorchDestroysZeroStrengthCow(t *testing.T) {
	c := Catalog{
		{Name: "Cow", Deck: "neutral", Row: "ranged", Strength: "0", Ability: "avenger", Count: "1"},
		{Name: "Bovine Defense Force", Deck: "neutral", Row: "close", Strength: "8", Count: "0"},
	}
	r := &Room{Players: []Player{
		{Rows: rows(), Special: rows(), Horn: map[string]bool{}},
		{Rows: rows(), Special: rows(), Horn: map[string]bool{}},
	}}
	r.Players[0].Rows["ranged"] = []Card{{UID: "cow", Def: 0}}
	r.destroyStrongest(c, -1, "", 0)
	if len(r.Players[0].Rows["ranged"]) != 0 {
		t.Fatal("Scorch must remove the zero-power Cow")
	}
	if len(r.Players[0].Grave) != 1 || r.Players[0].Grave[0].UID != "cow" {
		t.Fatal("Cow must be moved to its owner's graveyard")
	}
	if len(r.Players[0].Rows["close"]) != 1 || c[r.Players[0].Rows["close"][0].Def].Name != "Bovine Defense Force" {
		t.Fatal("Cow's avenger replacement must spawn after Scorch")
	}
}

func TestSkelligeThirdRoundReviveRunsAfterBothOldBoardsAreCleared(t *testing.T) {
	c := Catalog{
		{Name: "Spy", Deck: "skellige", Row: "close", Strength: "4", Ability: "spy"},
		{Name: "Soldier", Deck: "realms", Row: "close", Strength: "3"},
	}
	r := &Room{Round: 2, Status: "playing", Turn: 0, RoundStarter: 0, Players: []Player{
		{Faction: "skellige", Rows: rows(), Special: rows(), Horn: map[string]bool{}, Grave: []Card{{UID: "revived-spy", Def: 0}}},
		{Faction: "realms", Rows: rows(), Special: rows(), Horn: map[string]bool{}},
	}}
	r.Players[1].Rows["close"] = []Card{{UID: "old-soldier", Def: 1}}
	r.finishRound(c)
	if r.Round != 3 {
		t.Fatalf("got round %d want 3", r.Round)
	}
	cards := r.Players[1].Rows["close"]
	if len(cards) != 1 || cards[0].UID != "revived-spy" {
		t.Fatalf("revived spy should persist on opponent battlefield: %+v", cards)
	}
	if len(r.Players[1].Grave) != 1 || r.Players[1].Grave[0].UID != "old-soldier" {
		t.Fatalf("old opponent row should be cleared before revival: %+v", r.Players[1].Grave)
	}
}

func TestDecoyTriggersAvengerWithoutDiscardingOriginal(t *testing.T) {
	for _, variant := range []struct{ name, effect, replacement string }{
		{"Cow", "avenger", "Bovine Defense Force"},
		{"Kambi", "avenger_kambi", "Hemdall"},
	} {
		t.Run(variant.name, func(t *testing.T) {
			r, c := manualRoom()
			unit := appendCard(&c, variant.name, "ranged", variant.effect, 0)
			replacement := appendCard(&c, variant.replacement, "close", "", 8)
			decoy := Card{UID: "decoy", Def: c.Find("Decoy")}
			if decoy.Def < 0 {
				t.Fatal("fixture requires Decoy")
			}
			r.Players[0].Rows["ranged"] = []Card{unit}
			r.Players[0].Hand = []Card{decoy}
			if err := r.play(0, Action{Type: "play", UID: decoy.UID, Target: unit.UID}, c); err != nil {
				t.Fatal(err)
			}
			if len(r.Players[0].Hand) != 1 || r.Players[0].Hand[0].UID != unit.UID {
				t.Fatalf("return %s to hand", variant.name)
			}
			if len(r.Players[0].Grave) != 0 {
				t.Fatal("the returned unit cannot also go to grave")
			}
			if got := r.Players[0].Rows["ranged"]; len(got) != 1 || got[0].UID != decoy.UID {
				t.Fatalf("decoy must stay in the original row: %+v", got)
			}
			if got := r.Players[0].Rows["close"]; len(got) != 1 || got[0].Def != replacement.Def {
				t.Fatalf("expected %s: %+v", variant.replacement, got)
			}
		})
	}
}

func TestTerminalRoundIsClearedBeforeEndScreen(t *testing.T) {
	r, c := manualRoom()
	unit := appendCard(&c, "winning unit", "close", "", 5)
	c[unit.Def].Strength = "11"
	special := appendCard(&c, "Commander Horn", "", "horn", 0)
	c[special.Def].Deck = "special"
	weather := appendCard(&c, "Biting Frost", "weather", "frost", 0)
	c[weather.Def].Deck = "weather"
	r.Players[0].Rows["close"] = []Card{unit}
	r.Players[0].Special["close"] = []Card{special}
	r.Players[0].Horn["close"] = true
	r.Weather = []string{"frost"}
	r.WeatherCards = []WeatherPlacement{{Card: weather, Owner: 1}}
	r.Players[0].Wins = 1
	r.Round = 2
	r.Players[0].Passed, r.Players[1].Passed = true, true
	r.finishRound(c)
	if r.Status != "finished" || r.Winner != 0 || r.Round != 2 {
		t.Fatalf("wrong terminal state: %+v", r)
	}
	if len(r.RoundHistory) != 1 || r.RoundHistory[0].ScoreA != 2 {
		t.Fatalf("result before clearing must be retained: %+v", r.RoundHistory)
	}
	if r.Score(0, c) != 0 || r.Score(1, c) != 0 {
		t.Fatal("terminal board must be cleared")
	}
	if len(r.Players[0].Grave) != 2 || len(r.Players[0].Special["close"]) != 0 || r.Players[0].Horn["close"] {
		t.Fatal("original unit and horn must enter owner's grave")
	}
	if len(r.Players[1].Grave) != 1 || r.Players[1].Grave[0].UID != weather.UID || len(r.WeatherCards) != 0 || len(r.Weather) != 0 {
		t.Fatal("weather must clear to its owner")
	}
}

func TestTerminalRoundMonsterSurvivorIsStillRetained(t *testing.T) {
	r, c := manualRoom()
	r.Players[0].Faction = "monsters"
	unit := appendCard(&c, "monster", "siege", "", 4)
	r.Players[0].Rows["siege"] = []Card{unit}
	r.Players[0].Wins = 1
	r.Players[0].Passed, r.Players[1].Passed = true, true
	r.finishRound(c)
	if r.Status != "finished" || r.Winner != 0 {
		t.Fatalf("wrong result: %+v", r)
	}
	if got := r.Players[0].Rows["siege"]; len(got) != 1 || got[0].UID != unit.UID {
		t.Fatalf("Monsters should retain one unit on final clear: %+v", got)
	}
}

func TestLeaderHornRespectsOccupiedSpecialSlot(t *testing.T) {
	for _, leader := range []struct{ ability, row string }{
		{"foltest_siegemaster", "siege"}, {"eredin_commander", "close"}, {"francesca_beautiful", "ranged"},
	} {
		t.Run(leader.ability, func(t *testing.T) {
			r, c := manualRoom()
			lc := appendCard(&c, "Leader", "leader", leader.ability, 0)
			r.Players[0].Leader = lc.Def + 1
			unit := appendCard(&c, "Unit", leader.row, "", 5)
			special := appendCard(&c, "Mardroeme", "", "mardroeme", 0)
			c[special.Def].Deck = "special"
			r.Players[0].Rows[leader.row] = []Card{unit}
			r.Players[0].Special[leader.row] = []Card{special}
			score := r.Score(0, c)
			if err := r.activateLeader(0, Action{Type: "leader"}, c); err != nil {
				t.Fatal(err)
			}
			if !r.Players[0].LeaderUsed || r.Players[0].Horn[leader.row] || r.Score(0, c) != score {
				t.Fatal("leader horn cannot replace existing special")
			}
			if got := r.Project(0, c).Players[0].Special[leader.row]; len(got) != 1 || got[0].UID != special.UID {
				t.Fatalf("special slot changed: %+v", got)
			}
		})
	}
}

func TestLeaderHornProjectsTemporaryCardWithoutPuttingItInGrave(t *testing.T) {
	r, c := manualRoom()
	leader := appendCard(&c, "Foltest", "leader", "foltest_siegemaster", 0)
	c = append(c, Definition{Name: "Commander's Horn", Deck: "special", Ability: "horn", Count: "3"})
	r.Players[0].Leader = leader.Def + 1
	if err := r.activateLeader(0, Action{Type: "leader"}, c); err != nil {
		t.Fatal(err)
	}
	pv := r.Project(0, c).Players[0]
	if len(pv.Special["siege"]) != 1 || pv.Special["siege"][0].Name != "Commander's Horn" {
		t.Fatalf("virtual horn not displayed: %+v", pv.Special)
	}
	if len(r.Players[0].Special["siege"]) != 0 || len(r.Players[0].Grave) != 0 {
		t.Fatal("virtual horn is not a physical card")
	}
	r.Players[0].Passed, r.Players[1].Passed = true, true
	r.finishRound(c)
	if got := r.Project(0, c).Players[0].Special["siege"]; len(got) != 0 {
		t.Fatalf("leader horn must expire: %+v", got)
	}
}

func TestAutomaticPassAfterLastCard(t *testing.T) {
	r, c := manualRoom()
	card := Card{UID: "last-card", Def: c.Find("realms soldier 0")}
	r.Players[0].Hand = []Card{card}
	r.Players[0].LeaderUsed = true
	r.Players[1].LeaderUsed = true
	r.Players[1].Hand = []Card{{UID: "opponent-card", Def: c.Find("realms soldier 1")}}
	if err := r.Apply(0, Action{Type: "play", UID: card.UID, Row: "close"}, c); err != nil {
		t.Fatal(err)
	}
	if !r.Players[0].Passed || r.Players[1].Passed || r.Turn != 1 {
		t.Fatalf("exhausted hand should auto-pass and yield the turn: %+v", r.Players)
	}
	if err := r.Apply(0, Action{Type: "pass"}, c); err == nil {
		t.Fatal("a player who automatically passed may not act twice")
	}
	if err := r.Apply(1, Action{Type: "play", UID: "opponent-card", Row: "ranged"}, c); err != nil {
		t.Fatal(err)
	}
	if r.Status != "finished" || len(r.RoundHistory) != 2 {
		t.Fatalf("two drawn rounds must finish the match, got status=%s rounds=%d", r.Status, len(r.RoundHistory))
	}
}

func TestPassiveAndActiveLeadersHaveDifferentPassRules(t *testing.T) {
	r, c := manualRoom()
	passive := len(c) + 1
	c = append(c, Definition{Name: "King Bran", Deck: "skellige", Row: "leader", Ability: "king_bran"})
	active := len(c) + 1
	c = append(c, Definition{Name: "Clear Weather", Deck: "realms", Row: "leader", Ability: "foltest_lord"})
	r.Players[0].Leader = passive
	r.Players[1].Hand = []Card{{UID: "opponent-card", Def: c.Find("realms soldier 1")}}
	r.settleForcedPasses(c)
	if !r.Players[0].Passed || r.Turn != 1 {
		t.Fatal("passive leader must not keep an empty-hand player in the round")
	}
	r.Players[0].Passed = false
	r.Players[0].Leader = active
	r.Turn = 0
	r.settleForcedPasses(c)
	if r.Players[0].Passed || r.Turn != 0 {
		t.Fatal("active leader must keep its empty-hand player's turn available")
	}
}

func TestForcedPassCannotInterruptPendingMedicOrMulligan(t *testing.T) {
	r, c := manualRoom()
	r.PendingOwner = 1
	r.settleForcedPasses(c)
	if r.Players[0].Passed || r.Players[1].Passed {
		t.Fatal("forced passing interrupted chained Medic choice")
	}
	r.PendingOwner = 0
	r.Phase = "mulligan"
	r.settleForcedPasses(c)
	if r.Players[0].Passed || r.Players[1].Passed {
		t.Fatal("forced passing interrupted initial hand redraw")
	}
}

func TestEmptyGraveLeaderConsumesItsTurnWithoutGivingFreeCard(t *testing.T) {
	r, c := manualRoom()
	leader := appendCard(&c, "Emhyr empty grave", "leader", "emhyr_relentless", 0)
	r.Players[0].Leader = leader.Def + 1
	r.Players[1].Hand = []Card{{UID: "waiting", Def: c.Find("realms soldier 1")}}
	if err := r.Apply(0, Action{Type: "leader", Target: "forged"}, c); err == nil {
		t.Fatal("forged graveyard target must be rejected")
	}
	if r.Players[0].LeaderUsed {
		t.Fatal("rejected leader activation consumed its ability")
	}
	if err := r.Apply(0, Action{Type: "leader"}, c); err != nil {
		t.Fatal(err)
	}
	if !r.Players[0].LeaderUsed || !r.Players[0].Passed || r.Turn != 1 {
		t.Fatalf("empty graveyard ability should consume a turn and then auto-pass: %+v", r.Players)
	}
	if len(r.Players[0].Hand) != 0 || len(r.Players[1].Grave) != 0 {
		t.Fatal("empty graveyard leader cannot invent a card")
	}
}

func TestEmptyWeatherDeckLeaderConsumesItsTurn(t *testing.T) {
	r, c := manualRoom()
	leader := appendCard(&c, "Foltest empty weather", "leader", "foltest_king", 0)
	r.Players[0].Leader = leader.Def + 1
	r.Players[1].Hand = []Card{{UID: "waiting", Def: c.Find("realms soldier 1")}}
	if err := r.Apply(0, Action{Type: "leader", Target: "forged"}, c); err == nil {
		t.Fatal("weather leader must reject an impossible explicit selection")
	}
	if err := r.Apply(0, Action{Type: "leader"}, c); err != nil {
		t.Fatal(err)
	}
	if !r.Players[0].LeaderUsed || !r.Players[0].Passed || r.Turn != 1 {
		t.Fatal("original Foltest uses his ability even with no matching weather card")
	}
	if len(r.WeatherCards) != 0 {
		t.Fatal("weather was fabricated without a real card")
	}
}
