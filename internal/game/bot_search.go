package game

import (
	"fmt"
	"math"
)

// Build hypotheses solely from public zones, counts, faction and catalogue.
// The real opposing hand/deck never reaches this function.
func (r *Room) botSampleOpponent(seat, sample int, c Catalog) *Room {
	out := r.simulation()
	out.randomState = uint64(sample+1) * 0x9e3779b97f4a7c15
	out.shuffle(out.Players[seat].Deck)
	opp := 1 - seat
	p := &out.Players[opp]
	used := map[int]int{}
	for _, card := range p.Grave {
		used[card.Def]++
	}
	for _, row := range p.Rows {
		for _, card := range row {
			used[card.Def]++
		}
	}
	for _, row := range out.Players[seat].Rows {
		for _, card := range row {
			if c[card.Def].Has("spy") {
				used[card.Def]++
			}
		}
	}
	for _, weather := range out.WeatherCards {
		if weather.Owner == opp {
			used[weather.Card.Def]++
		}
	}
	var units, specials []Card
	for def, d := range c {
		if d.Row == "leader" || (d.Deck != p.Faction && d.Deck != "neutral" && d.Deck != "special" && d.Deck != "weather") {
			continue
		}
		for copy := used[def]; copy < d.Copies(); copy++ {
			card := Card{UID: fmt.Sprintf("guess-%d-%d-%d", sample, def, copy), Def: def}
			if d.Deck == "special" || d.Deck == "weather" {
				specials = append(specials, card)
			} else {
				units = append(units, card)
			}
		}
	}
	out.shuffle(units)
	out.shuffle(specials)
	// The prior follows the generated deck's mix, rather than treating every
	// catalogue special as equally likely to be in a player's small deck.
	handCount, deckCount := len(p.Hand), len(p.Deck)
	p.Hand, p.Deck = nil, nil
	specialCount := 0
	for def, count := range used {
		if c[def].Deck == "special" || c[def].Deck == "weather" {
			specialCount += count
		}
	}
	for i := 0; i < handCount+deckCount; i++ {
		var card Card
		if len(specials) > 0 && specialCount < 10 && (len(units) == 0 || out.randomInt(100) < 23) {
			card, specials = specials[len(specials)-1], specials[:len(specials)-1]
			specialCount++
		} else if len(units) > 0 {
			card, units = units[len(units)-1], units[:len(units)-1]
		} else {
			break
		}
		if i < handCount {
			p.Hand = append(p.Hand, card)
		} else {
			p.Deck = append(p.Deck, card)
		}
	}
	return out
}

// Compare whole hypothetical matches, not just the next point swing. All
// roots use the same sampled deals. The rollout policy observes only its own
// cards, and never recursively invokes the hard search.
func (r *Room) botLookahead(seat int, options []botOption, minimum float64, c Catalog) Action {
	roots := append([]botOption(nil), options[:min(4, len(options))]...)
	roots = append(roots, botOption{action: Action{Type: "pass"}, score: minimum})
	best, bestScore := options[0].action, math.Inf(-1)
	for _, root := range roots {
		value := 0.0
		for sample := 0; sample < 3; sample++ {
			state := r.botSampleOpponent(seat, sample, c)
			if err := state.Apply(seat, root.action, c); err != nil {
				value -= 100
				continue
			}
			for step := 0; state.Status == "playing" && step < 80; step++ {
				actor := state.Turn
				if state.PendingOwner != 0 {
					actor = state.PendingOwner - 1
				}
				action := state.botDecision(actor, c, BotNormal)
				if err := state.Apply(actor, action, c); err != nil {
					break
				}
			}
			if state.Status == "finished" {
				if state.Winner == seat {
					value += 100
				} else if state.Winner == -1 {
					value += 50
				}
			} else {
				// Bounded fallback for unusual very long Medic/Decoy games.
				advantage := float64(state.Players[seat].Wins-state.Players[1-seat].Wins) * 20
				advantage += float64(state.Score(seat, c)-state.Score(1-seat, c)) * .25
				advantage += (state.botReserve(seat, c) - state.botReserve(1-seat, c)) * .5
				value += math.Max(1, math.Min(99, 50+advantage))
			}
		}
		value += root.score * .001
		if value > bestScore {
			best, bestScore = root.action, value
		}
	}
	return best
}
