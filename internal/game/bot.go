package game

import (
	"math"
	"slices"
	"sort"
	"strings"
)

const botPolicyVersion = "resource-mc-v1"

type botOption struct {
	action               Action
	score, gain, reserve float64
	state                *Room
}

func musterKey(d Definition) string {
	if d.Muster != "" {
		return d.Muster
	}
	return strings.TrimSpace(strings.SplitN(d.Name, "-", 2)[0])
}

func botBaseValue(d Definition) float64 {
	value := float64(d.Power())
	switch {
	case d.Has("spy"):
		return 17 - value*.65
	case d.Has("medic"):
		value += 7
	case d.Has("decoy"):
		return 7
	case d.Has("clear"):
		return 5
	case d.Deck == "weather":
		return 4
	case d.Deck == "special" && d.Has("horn"):
		return 7
	case d.Deck == "special" && d.Has("scorch"):
		return 7
	case d.Deck == "special" && d.Has("mardroeme"):
		return 3
	}
	if d.Has("hero") {
		value += 2
	}
	if d.Has("morale") {
		value += 3
	}
	if d.Has("bond") {
		value += 3
	}
	if d.Has("avenger") || d.Has("avenger_kambi") {
		value += 7
	}
	if d.Has("scorch_c") || d.Has("scorch_r") || d.Has("scorch_s") || d.Has("scorch") {
		value += 4
	}
	if d.Has("horn") {
		value += 5
	}
	return value
}

func (r *Room) botCardValue(seat int, card Card, c Catalog) float64 {
	d, p := c[card.Def], r.Players[seat]
	value := botBaseValue(d)
	if d.Has("spy") {
		value = float64(min(2, len(p.Deck)))*8 - float64(d.Power())*.65
	}
	if d.Has("muster") {
		key := musterKey(d)
		for _, other := range p.Deck {
			if strings.HasPrefix(c[other.Def].Name, key) {
				value += float64(c[other.Def].Power()) * .8
			}
		}
		for _, row := range p.Rows {
			for _, other := range row {
				if c[other.Def].Name == d.Name {
					value += float64(d.Power()) * 1.3
				}
			}
		}
	}
	if d.Has("bond") {
		for _, other := range p.Hand {
			if other.UID != card.UID && c[other.Def].Name == d.Name {
				value += float64(d.Power()) * .65
			}
		}
	}
	if d.Has("medic") && len(r.eligibleGrave(seat, c)) == 0 {
		value -= 4
	}
	if d.Has("decoy") {
		for _, row := range p.Rows {
			for _, other := range row {
				if isUnit(c[other.Def]) && (c[other.Def].Has("spy") || c[other.Def].Has("medic")) {
					value += 3
					return value
				}
			}
		}
	}
	return math.Max(0, value)
}

func (r *Room) botReserve(seat int, c Catalog) float64 {
	value := 0.0
	musters := map[string]bool{}
	for _, card := range r.Players[seat].Hand {
		d := c[card.Def]
		if d.Has("muster") {
			key := musterKey(d)
			if musters[key] {
				continue
			}
			musters[key] = true
		}
		value += r.botCardValue(seat, card, c)
	}
	return value
}

// The opening exchange evaluates abilities and deck composition, not printed
// strength. In particular, a zero-strength spy is never treated as a weak unit.
func (r *Room) botRedrawChoice(seat int, c Catalog) string {
	p := r.Players[seat]
	if len(p.Deck) == 0 || p.Redraws <= 0 {
		return ""
	}
	keep := func(card Card) float64 {
		d := c[card.Def]
		value := r.botCardValue(seat, card, c)
		if d.Has("muster") {
			for _, other := range p.Hand {
				if other.UID != card.UID && strings.HasPrefix(c[other.Def].Name, musterKey(d)) {
					return -10
				}
			}
		}
		if d.Deck == "weather" && !d.Has("clear") {
			if r.leaderHas(seat, c, "eredin_king") ||
				(d.Has("frost") && r.leaderHas(seat, c, "francesca_pureblood")) ||
				(d.Has("fog") && r.leaderHas(seat, c, "foltest_king")) ||
				(d.Has("rain") && r.leaderHas(seat, c, "emhyr_imperial")) {
				return -8
			}
		}
		return value
	}
	average := 0.0
	for _, card := range p.Deck {
		average += keep(card)
	}
	average /= float64(len(p.Deck))
	weakest, worst := "", average-.75
	for _, card := range p.Hand {
		if value := keep(card); value < worst {
			weakest, worst = card.UID, value
		}
	}
	return weakest
}

func (r *Room) botRevivalActions(seat int, c Catalog) []Action {
	var actions []Action
	for _, card := range r.eligibleGrave(seat, c) {
		rows := []string{""}
		if c[card.Def].Row == "agile" {
			rows = []string{"close", "ranged"}
		}
		for _, row := range rows {
			actions = append(actions, Action{Type: "revive", Target: card.UID, TargetRow: row})
		}
	}
	return actions
}

func (r *Room) botRevivalHint(seat int, c Catalog) Action {
	best := Action{}
	value := math.Inf(-1)
	for _, a := range r.botRevivalActions(seat, c) {
		card := cardByUID(r.Players[seat].Grave, a.Target)
		d := c[card.Def]
		gain := r.botCardValue(seat, card, c)
		if d.Has("medic") && len(r.eligibleGrave(seat, c)) > 1 {
			gain += 12
		}
		row := a.TargetRow
		if row == "" {
			row = d.Row
		}
		if !d.Has("hero") && ((row == "close" && slices.Contains(r.Weather, "frost")) ||
			(row == "ranged" && (slices.Contains(r.Weather, "fog") || slices.Contains(r.Weather, "storm"))) ||
			(row == "siege" && (slices.Contains(r.Weather, "rain") || slices.Contains(r.Weather, "storm")))) {
			gain -= float64(d.Power() - 1)
		}
		if gain > value {
			best, value = a, gain
		}
	}
	return best
}

func (r *Room) botSimulateAction(seat int, a Action, c Catalog) (*Room, bool) {
	sim := r.simulation()
	var err error
	switch a.Type {
	case "leader":
		err = sim.activateLeader(seat, a, c)
	case "play":
		err = sim.play(seat, a, c)
	case "revive":
		err = sim.validateRevivePlacement(seat, a.Target, a.TargetRow, c)
		if err == nil {
			sim.PendingOwner = 0
			sim.resolveMedic(seat, a.Target, a.TargetRow, c)
		}
	default:
		return nil, false
	}
	if err != nil {
		return nil, false
	}
	// Finish explicit Medic chains in the same simulated turn. Each step removes
	// a grave card; the guard is also a budget for deliberately oversized decks.
	for n := 0; sim.PendingOwner == seat+1 && n < 32; n++ {
		next := sim.botRevivalHint(seat, c)
		if next.Target == "" {
			break
		}
		sim.PendingOwner = 0
		sim.resolveMedic(seat, next.Target, next.TargetRow, c)
	}
	return sim, true
}

func (r *Room) botEvaluate(seat int, a Action, c Catalog) (botOption, bool) {
	sim, valid := r.botSimulateAction(seat, a, c)
	if !valid {
		return botOption{}, false
	}
	opp := 1 - seat
	gain := float64(sim.Score(seat, c) - r.Score(seat, c) - sim.Score(opp, c) + r.Score(opp, c))
	reserve := sim.botReserve(seat, c)
	weight := .72
	if r.Round >= 3 || r.Players[opp].Wins >= 1 {
		weight = .12
	}
	if r.Bot != nil && r.Bot.Style == "economy" {
		weight += .12
	}
	if r.Bot != nil && r.Bot.Style == "aggressive" {
		weight -= .12
	}
	score := gain + (reserve-r.botReserve(seat, c))*weight
	// Drawn cards are available in this round, even when no future round
	// remains. Don't discount a final-round Spy as if its draws were unused.
	deck := map[string]bool{}
	for _, card := range r.Players[seat].Deck {
		deck[card.UID] = true
	}
	for _, card := range sim.Players[seat].Hand {
		if deck[card.UID] {
			score += sim.botCardValue(seat, card, c) * (1 - weight)
		}
	}
	if a.Type == "leader" {
		score -= 2.5
	}
	if a.Type == "play" && c[cardByUID(r.Players[seat].Hand, a.UID).Def].Has("medic") && len(r.eligibleGrave(seat, c)) == 0 && weight > .5 {
		score -= 4
	}
	return botOption{action: a, score: score, gain: gain, reserve: reserve, state: sim}, true
}

func (r *Room) botOptions(seat int, c Catalog) []botOption {
	actions := r.candidateActions(seat, c)
	if r.PendingOwner == seat+1 {
		actions = r.botRevivalActions(seat, c)
	}
	options := make([]botOption, 0, len(actions))
	for _, a := range actions {
		if next, valid := r.botEvaluate(seat, a, c); valid {
			options = append(options, next)
		}
	}
	sort.SliceStable(options, func(i, j int) bool { return options[i].score > options[j].score })
	return options
}

func (r *Room) botSettlement(seat int, c Catalog) float64 {
	winner := r.roundWinner(c)
	own, opp := r.Players[seat].Wins, r.Players[1-seat].Wins
	if winner == seat || winner == -1 {
		own++
	}
	if winner == 1-seat || winner == -1 {
		opp++
	}
	if own >= 2 || opp >= 2 || r.Round >= 3 {
		if own > opp {
			return 10000
		}
		if own < opp {
			return -10000
		}
		return 0
	}
	value := float64(own-opp)*40 + r.botReserve(seat, c)
	if winner >= 0 && r.Players[winner].Faction == "realms" && len(r.Players[winner].Deck) > 0 {
		if winner == seat {
			value += 7
		} else {
			value -= 7
		}
	}
	return value
}

// With a passed opponent the bot can plan its own sequence without guessing
// hidden replies. Bound the number of evaluated continuations, not wall time.
func (r *Room) botAgainstPassed(seat int, options []botOption, c Catalog, difficulty BotDifficulty) Action {
	best, value := Action{Type: "pass"}, r.botSettlement(seat, c)
	depth, budget := 2, 64
	if difficulty == BotHard {
		depth, budget = 3, 160
	}
	var visit func(*Room, Action, int)
	visit = func(state *Room, first Action, remaining int) {
		if next := state.botSettlement(seat, c); next > value+.01 {
			best, value = first, next
		}
		if remaining <= 0 || budget <= 0 {
			return
		}
		for _, a := range state.candidateActions(seat, c) {
			if budget <= 0 {
				break
			}
			budget--
			if sim, valid := state.botSimulateAction(seat, a, c); valid {
				visit(sim, first, remaining-1)
			}
		}
	}
	// Every root move gets inspected before spending the continuation budget.
	for _, option := range options {
		if next := option.state.botSettlement(seat, c); next > value+.01 {
			best, value = option.action, next
		}
	}
	for _, option := range options {
		visit(option.state, option.action, depth-1)
	}
	if best.Type == "pass" && r.Players[1-seat].Wins >= 1 && r.roundWinner(c) != seat && value < 0 {
		// A short search can miss a win requiring many small units. Keep trying
		// useful moves when conceding would lose the match anyway.
		for _, option := range options {
			if option.gain > 0 || option.reserve > r.botReserve(seat, c) {
				return option.action
			}
		}
	}
	return best
}

func (r *Room) botDecision(seat int, c Catalog, difficulty BotDifficulty) Action {
	position := r.botObservation(seat)
	options := position.botOptions(seat, c)
	if len(options) == 0 {
		return Action{Type: "pass"}
	}
	if position.PendingOwner == seat+1 {
		return options[0].action
	}
	if difficulty == BotEasy {
		if position.Players[1-seat].Passed && position.roundWinner(c) == seat {
			return Action{Type: "pass"}
		}
		return options[r.randomInt(len(options))].action
	}
	if position.Players[1-seat].Passed {
		return position.botAgainstPassed(seat, options, c, difficulty)
	}
	best := options[0]
	pass := -8.0
	// A loss is affordable only while the opponent has not won a round yet.
	if position.Players[1-seat].Wins == 0 && position.Round < 3 {
		deficit := position.Score(1-seat, c) - position.Score(seat, c)
		if deficit > 0 {
			maxGain := 1.0
			for _, option := range options {
				maxGain = math.Max(maxGain, option.gain)
			}
			pass = -3 + math.Max(0, float64(deficit)/maxGain-1)*5
			pass += float64(max(0, len(position.Players[1-seat].Hand)-len(position.Players[seat].Hand))) * 1.5
		}
	} else {
		pass = -10000
		if position.roundWinner(c) == seat {
			pass = -.5
		}
	}
	if difficulty == BotHard {
		return position.botLookahead(seat, options, pass, c)
	}
	if best.score < pass {
		return Action{Type: "pass"}
	}
	return best.action
}

// Kept for existing engine callers/tests; normal no longer adds arbitrary noise.
func (r *Room) botChoiceScore(a Action, c Catalog, _ BotDifficulty) (int, bool) {
	option, valid := r.botObservation(1).botEvaluate(1, a, c)
	return int(option.score * 100), valid
}

func (r *Room) Bots(c Catalog) {
	if r.Mode != "bot" {
		return
	}
	difficulty := BotNormal
	if r.Bot != nil {
		difficulty = r.Bot.Difficulty
	}
	for moves := 0; moves < 100 && r.Status == "playing" && r.Turn == 1 && r.Initiative == 0 && r.Phase != "mulligan"; moves++ {
		action := r.botDecision(1, c, difficulty)
		if err := r.ApplyBot(action, c); err != nil {
			// Keep a corrupted/legacy position from stalling the whole room.
			if r.PendingOwner != 0 {
				break
			}
			_ = r.ApplyBot(Action{Type: "pass"}, c)
		}
	}
}
