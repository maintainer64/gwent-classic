package game

import (
	"cmp"
	"fmt"
	"slices"
)

func cloneRows[T any](src map[string][]T) map[string][]T {
	if src == nil {
		return nil
	}
	out := make(map[string][]T, len(src))
	for key, cards := range src {
		out[key] = slices.Clone(cards)
	}
	return out
}

func cloneFlags(src map[string]bool) map[string]bool {
	if src == nil {
		return nil
	}
	out := make(map[string]bool, len(src))
	for key, value := range src {
		out[key] = value
	}
	return out
}

func clonePlayer(p Player) Player {
	p.Hand, p.Deck, p.Grave = slices.Clone(p.Hand), slices.Clone(p.Deck), slices.Clone(p.Grave)
	p.Peek, p.StartingDeck = slices.Clone(p.Peek), slices.Clone(p.StartingDeck)
	p.Rows, p.Special = cloneRows(p.Rows), cloneRows(p.Special)
	p.Horn, p.Mardroeme = cloneFlags(p.Horn), cloneFlags(p.Mardroeme)
	return p
}

// Copy mutable state without serializing the room or recording animation history.
func (r *Room) simulation() *Room {
	out := *r
	out.Players = make([]Player, len(r.Players))
	for i, p := range r.Players {
		out.Players[i] = clonePlayer(p)
	}
	if r.Bot != nil {
		bot := *r.Bot
		bot.Deck = slices.Clone(bot.Deck)
		out.Bot = &bot
	}
	if r.Timer != nil {
		timer := *r.Timer
		out.Timer = &timer
	}
	out.Weather = slices.Clone(r.Weather)
	out.WeatherCards = slices.Clone(r.WeatherCards)
	out.RoundHistory = slices.Clone(r.RoundHistory)
	out.Events, out.Transitions = nil, nil
	out.simulating = true
	if out.randomState == 0 {
		out.randomState = 1
	}
	return &out
}

// The first-stage policy searches only its own continuations. Hidden opponent
// cards are count-only placeholders, and its own draw order is canonicalized.
// Callers never pass the authoritative room to the evaluator.
func (r *Room) botObservation(seat int) *Room {
	out := &Room{
		Mode: "pvp", Status: r.Status, Phase: r.Phase, Turn: seat,
		Round: r.Round, RoundStarter: r.RoundStarter, PendingOwner: r.PendingOwner,
		Weather: slices.Clone(r.Weather), WeatherCards: slices.Clone(r.WeatherCards),
		RoundHistory: slices.Clone(r.RoundHistory), Players: make([]Player, 2),
		simulating: true, randomState: 1,
	}
	if r.Bot != nil {
		out.Bot = &BotOptions{Difficulty: r.Bot.Difficulty, Style: r.Bot.Style}
	}
	for i, p := range r.Players {
		out.Players[i] = Player{
			Name: p.Name, Faction: p.Faction, Leader: p.Leader, LeaderUsed: p.LeaderUsed,
			Passed: p.Passed, Wins: p.Wins, Ready: p.Ready, Redraws: p.Redraws,
			Rows: cloneRows(p.Rows), Special: cloneRows(p.Special),
			Horn: cloneFlags(p.Horn), Mardroeme: cloneFlags(p.Mardroeme), Grave: slices.Clone(p.Grave),
		}
		if i == seat {
			out.Players[i].Hand, out.Players[i].Deck = slices.Clone(p.Hand), slices.Clone(p.Deck)
			out.Players[i].Peek = slices.Clone(p.Peek)
			slices.SortFunc(out.Players[i].Deck, func(a, b Card) int {
				if a.Def != b.Def {
					return a.Def - b.Def
				}
				return cmp.Compare(a.UID, b.UID)
			})
			// Fixed sampling breaks correlation with the real draw order while
			// retaining the known composition of the player's own deck.
			out.shuffle(out.Players[i].Deck)
		} else {
			out.Players[i].Hand = make([]Card, len(p.Hand))
			out.Players[i].Deck = make([]Card, len(p.Deck))
		}
	}
	return out
}

// SplitMix64 is for simulated chance only. Live rooms continue using crypto/rand.
func (r *Room) randomInt(n int) int {
	if r.randomState == 0 {
		return randomInt(n)
	}
	if n <= 1 {
		return 0
	}
	r.randomState += 0x9e3779b97f4a7c15
	z := r.randomState
	z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
	z = (z ^ (z >> 27)) * 0x94d049bb133111eb
	return int((z ^ (z >> 31)) % uint64(n))
}

func (r *Room) shuffle(cards []Card) {
	for i := len(cards) - 1; i > 0; i-- {
		j := r.randomInt(i + 1)
		cards[i], cards[j] = cards[j], cards[i]
	}
}

func (r *Room) effectUID() string {
	if r.randomState == 0 {
		return randomUID()
	}
	return fmt.Sprintf("simulation-%x-%x", r.randomInt(1<<30), r.randomInt(1<<30))
}
