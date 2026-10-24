package game

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"testing"
	"time"
)

func (r *Room) legacyBotDecision(seat int, c Catalog) Action {
	position := r.simulation()
	if seat == 0 {
		position.Players[0], position.Players[1] = position.Players[1], position.Players[0]
		if position.PendingOwner != 0 {
			position.PendingOwner = 3 - position.PendingOwner
		}
		for i := range position.WeatherCards {
			position.WeatherCards[i].Owner = 1 - position.WeatherCards[i].Owner
		}
	}
	p := position.Players[1]
	if position.PendingOwner == 2 {
		options := position.eligibleGrave(1, c)
		if len(options) == 0 {
			return Action{Type: "pass"}
		}
		best := options[0]
		for _, card := range options {
			if c[card.Def].Power() > c[best.Def].Power() {
				best = card
			}
		}
		return Action{Type: "revive", Target: best.UID}
	}
	if len(p.Hand) == 0 && (p.LeaderUsed || position.leadersNullified(c)) {
		return Action{Type: "pass"}
	}
	if position.Players[0].Passed && position.Score(1, c) > position.Score(0, c) {
		return Action{Type: "pass"}
	}
	best, value, found := Action{Type: "pass"}, 0, false
	for _, action := range position.legacyCandidateActions(1, c) {
		score, valid := position.legacyBotChoiceScore(action, c, BotHard)
		if valid && (!found || score > value) {
			best, value, found = action, score, true
		}
	}
	if position.Round < 3 && !position.Players[0].Passed && value < 0 && len(p.Hand) < 6 {
		return Action{Type: "pass"}
	}
	return best
}

// Same generated deck rules as the existing game, with deterministic test IDs
// and chance. The two games of a pair have identical factions, decks and deal;
// only the seat running the new policy changes.
func botArenaRoom(c Catalog, first, second string, seed uint64) *Room {
	r := &Room{Mode: "pvp", Bot: &BotOptions{Style: "balanced"}, Status: "waiting", randomState: seed, simulating: true}
	for seat, faction := range []string{first, second} {
		p := Player{Name: faction, Faction: faction, Rows: rows(), Special: rows(), Horn: map[string]bool{}, Mardroeme: map[string]bool{}}
		var units, specials []Card
		for def, d := range c {
			if d.Deck != faction && d.Deck != "neutral" && d.Deck != "special" && d.Deck != "weather" {
				continue
			}
			if d.Row == "leader" {
				continue
			}
			for copy := 0; copy < d.Copies(); copy++ {
				card := Card{UID: fmt.Sprintf("%d-%d-%d", seat, def, copy), Def: def}
				if d.Deck == "special" || d.Deck == "weather" {
					specials = append(specials, card)
				} else {
					units = append(units, card)
				}
			}
		}
		var leaders []int
		for _, leader := range LeaderOptions(c) {
			if leader.Faction == faction {
				leaders = append(leaders, leader.ID)
			}
		}
		p.Leader = leaders[r.randomInt(len(leaders))]
		r.shuffle(units)
		r.shuffle(specials)
		p.Deck = append(p.Deck, units[:min(len(units), 27)]...)
		p.Deck = append(p.Deck, specials[:min(len(specials), 8)]...)
		r.shuffle(p.Deck)
		r.Players = append(r.Players, p)
	}
	r.start(c)
	return r
}

func playBotArena(t *testing.T, c Catalog, first, second string, seed uint64, candidate int, level BotDifficulty, opponent string) (int, time.Duration, int) {
	t.Helper()
	r := botArenaRoom(c, first, second, seed)
	for seat := range r.Players {
		for n := 0; n < 2; n++ {
			uid := ""
			if seat == candidate || opponent == "normal" {
				uid = r.botRedrawChoice(seat, c)
			} else {
				weakest := r.Players[seat].Hand[0]
				for _, card := range r.Players[seat].Hand {
					if c[card.Def].Power() < c[weakest.Def].Power() {
						weakest = card
					}
				}
				uid = weakest.UID
			}
			if uid == "" {
				break
			}
			if err := r.redraw(seat, uid, c); err != nil {
				t.Fatal(err)
			}
		}
		r.Players[seat].Ready = true
	}
	r.Phase = "turn"
	if r.Initiative != 0 {
		if err := r.Apply(r.Initiative-1, Action{Type: "initiative", Target: "self"}, c); err != nil {
			t.Fatal(err)
		}
	}
	var elapsed time.Duration
	decisions := 0
	for step := 0; r.Status == "playing" && step < 500; step++ {
		seat := r.Turn
		if r.PendingOwner != 0 {
			seat = r.PendingOwner - 1
		}
		var action Action
		if seat == candidate {
			start := time.Now()
			action = r.botDecision(seat, c, level)
			elapsed += time.Since(start)
			decisions++
		} else if opponent == "normal" {
			action = r.botDecision(seat, c, BotNormal)
		} else {
			action = r.legacyBotDecision(seat, c)
		}
		if err := r.Apply(seat, action, c); err != nil {
			t.Fatalf("%s/%s seed=%d candidate=%d step=%d: %+v: %v", first, second, seed, candidate, step, action, err)
		}
	}
	if r.Status != "finished" {
		t.Fatalf("arena stalled: %s/%s seed=%d", first, second, seed)
	}
	if r.Winner == -1 {
		return 0, elapsed, decisions
	}
	if r.Winner == candidate {
		return 1, elapsed, decisions
	}
	return -1, elapsed, decisions
}

func TestBotArena(t *testing.T) {
	count := os.Getenv("GWENT_BOT_ARENA_SEEDS")
	if count == "" {
		t.Skip("set GWENT_BOT_ARENA_SEEDS to run the paired strength experiment")
	}
	seeds, err := strconv.Atoi(count)
	if err != nil || seeds < 1 || seeds > 1000 {
		t.Fatal("GWENT_BOT_ARENA_SEEDS must be 1..1000")
	}
	c := realCatalog(t)
	opponent := os.Getenv("GWENT_BOT_ARENA_OPPONENT")
	if opponent == "" {
		opponent = "legacy-hard"
	}
	if opponent != "normal" && opponent != "legacy-hard" {
		t.Fatal("GWENT_BOT_ARENA_OPPONENT must be normal or legacy-hard")
	}
	startSeed := 1
	if raw := os.Getenv("GWENT_BOT_ARENA_SEED_START"); raw != "" {
		startSeed, err = strconv.Atoi(raw)
		if err != nil || startSeed < 1 {
			t.Fatal("GWENT_BOT_ARENA_SEED_START must be positive")
		}
	}
	type result struct {
		Policy                   string        `json:"policy"`
		Opponent                 string        `json:"opponent"`
		Level                    BotDifficulty `json:"level"`
		Wins, Draws, Losses      int
		ScoreShare               float64
		MeanDecisionMilliseconds float64
	}
	var results []result
	for _, level := range []BotDifficulty{BotNormal, BotHard} {
		out := result{Policy: botPolicyVersion, Level: level, Opponent: opponent}
		var elapsed time.Duration
		decisions := 0
		for _, first := range Factions {
			for _, second := range Factions {
				for seed := startSeed; seed < startSeed+seeds; seed++ {
					for candidate := range 2 {
						winner, duration, moves := playBotArena(t, c, first, second, uint64(seed), candidate, level, opponent)
						elapsed += duration
						decisions += moves
						switch winner {
						case 1:
							out.Wins++
						case 0:
							out.Draws++
						case -1:
							out.Losses++
						}
					}
				}
			}
		}
		out.ScoreShare = (float64(out.Wins) + float64(out.Draws)*.5) / float64(out.Wins+out.Draws+out.Losses)
		if opponent == "normal" && level == BotNormal && out.ScoreShare != .5 {
			t.Fatal("paired identical-policy control was not symmetric")
		}
		out.MeanDecisionMilliseconds = float64(elapsed.Microseconds()) / 1000 / float64(decisions)
		results = append(results, out)
		t.Logf("%s %s vs %s: %d W / %d D / %d L, score share %.1f%%, mean decision %.2fms", out.Policy, level, opponent, out.Wins, out.Draws, out.Losses, out.ScoreShare*100, out.MeanDecisionMilliseconds)
	}
	if path := os.Getenv("GWENT_BOT_ARENA_REPORT"); path != "" {
		data, _ := json.MarshalIndent(results, "", "  ")
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
}
