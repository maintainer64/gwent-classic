package game

// Frames contain only public zones and counters. Private hands, deck choices
// and shuffled order can never leak through animation history.
type BoardFrame struct {
	Players []PlayerView `json:"players"`
	Weather []string     `json:"weather"`
	Round   int          `json:"round"`
	Status  string       `json:"status"`
}
type MatchEvent struct {
	ID         int        `json:"id"`
	Type       string     `json:"type"`
	Actor      int        `json:"actor"`
	Card       *CardView  `json:"card,omitempty"`
	Row        string     `json:"row,omitempty"`
	PrivateFor int        `json:"privateFor,omitempty"`
	Frame      BoardFrame `json:"frame"`
}

func (r *Room) emit(kind string, actor int, card *Card, row string, private bool, c Catalog) {
	if r.simulating || r.clearingRound || len(r.Players) != 2 {
		return
	}
	r.EventSeq++
	e := MatchEvent{ID: r.EventSeq, Type: kind, Actor: actor, Row: row}
	if card != nil {
		v := cardView(*card, c)
		e.Card = &v
	}
	if private {
		e.PrivateFor = actor + 1
	}
	view := r.projectState(-1, c)
	e.Frame = BoardFrame{Players: view.Players, Weather: view.Weather, Round: r.Round, Status: r.Status}
	r.Transitions = append(r.Transitions, e)
	if len(r.Transitions) > 64 {
		r.Transitions = append([]MatchEvent(nil), r.Transitions[len(r.Transitions)-64:]...)
	}
}
func (r *Room) Project(seat int, c Catalog) View {
	v := r.projectState(seat, c)
	v.EventSeq = r.EventSeq
	for _, event := range r.Transitions {
		if event.PrivateFor != 0 && event.PrivateFor != seat+1 {
			event.Card = nil
		}
		v.Transitions = append(v.Transitions, event)
	}
	return v
}
