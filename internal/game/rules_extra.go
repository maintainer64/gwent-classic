package game

import (
	"errors"
	"strings"
)

// These helpers implement the effects that depend on the physical card zones.
// The caller must validate player actions before removing cards from their source zone.
func isUnit(d Definition) bool {
	switch d.Row {
	case "close", "ranged", "siege", "agile":
		return !d.Has("hero")
	}
	return false
}

func (r *Room) eligibleGrave(owner int, c Catalog) []Card {
	var out []Card
	for _, card := range r.Players[owner].Grave {
		if isUnit(c[card.Def]) {
			out = append(out, card)
		}
	}
	return out
}

func (r *Room) randomRevival(c Catalog) bool {
	return r.leaderHas(0, c, "emhyr_invader") || r.leaderHas(1, c, "emhyr_invader")
}

func (r *Room) validateReviveTarget(owner int, target string, c Catalog) error {
	candidates := r.eligibleGrave(owner, c)
	if len(candidates) == 0 {
		if target != "" {
			return errors.New("no revive target exists")
		}
		return nil
	}
	if r.randomRevival(c) {
		return nil
	}
	for _, card := range candidates {
		if card.UID == target {
			return nil
		}
	}
	return errors.New("select a non-hero unit from the appropriate graveyard")
}

// targetRow belongs to the revived unit, not to the Medic being played.
// Empty preserves the default row used by older clients and timeout recovery.
func (r *Room) validateRevivePlacement(owner int, target, targetRow string, c Catalog) error {
	if err := r.validateReviveTarget(owner, target, c); err != nil {
		return err
	}
	if targetRow == "" {
		return nil
	}
	if r.randomRevival(c) {
		return errors.New("random revival cannot choose a destination in advance")
	}
	for _, card := range r.eligibleGrave(owner, c) {
		if card.UID == target {
			if !validRow(c[card.Def], targetRow) {
				return errors.New("invalid revived unit row")
			}
			return nil
		}
	}
	return errors.New("no revive target exists")
}

// A revived Medic resolves another revival. With Invader the entire chain is
// random; otherwise the same turn waits for the next explicit choice.
func (r *Room) resolveMedic(owner int, target, targetRow string, c Catalog) {
	for {
		revived := r.reviveTargetAt(owner, target, targetRow, c)
		if revived == nil || !c[revived.Def].Has("medic") || len(r.eligibleGrave(owner, c)) == 0 {
			return
		}
		if !r.randomRevival(c) {
			r.PendingOwner = owner + 1
			return
		}
		target, targetRow = "", ""
	}
}

// Revive may be redirected by Emhyr's Invader of the North leader power.
func (r *Room) reviveTarget(owner int, target string, c Catalog) *Card {
	return r.reviveTargetAt(owner, target, "", c)
}
func (r *Room) reviveTargetAt(owner int, target, targetRow string, c Catalog) *Card {
	options := r.eligibleGrave(owner, c)
	if len(options) == 0 {
		return nil
	}
	if r.randomRevival(c) {
		target = options[r.randomInt(len(options))].UID
	}
	for _, card := range options {
		if card.UID != target {
			continue
		}
		p := &r.Players[owner]
		taken, ok := take(&p.Grave, target)
		if !ok {
			return nil
		}
		row := c[taken.Def].Row
		if row == "agile" {
			row = "close"
			if targetRow == "ranged" {
				row = targetRow
			}
		}
		destination := owner
		if c[taken.Def].Has("spy") {
			destination = 1 - owner
		}
		r.place(destination, taken, row, c)
		r.onPlaced(owner, taken, row, c)
		return &taken
	}
	return nil
}

// Resolve effects for a summoned/revived unit, never again resolve its 'medic'
// recursively without an explicit player choice.
// Mardroeme may be a special row card or the HERO Ermion. Both set the
// same row effect and transform existing and subsequently deployed Berserkers.
func (r *Room) applyMardroeme(owner int, row string, c Catalog) {
	p := &r.Players[owner]
	if p.Mardroeme == nil {
		p.Mardroeme = map[string]bool{}
	}
	p.Mardroeme[row] = true
	for i, unit := range p.Rows[row] {
		d := c[unit.Def]
		if !d.Has("berserker") {
			continue
		}
		target := 206
		if strings.Contains(d.Name, "Young") {
			target = 207
		}
		if target < len(c) {
			p.Rows[row][i] = Card{UID: unit.UID + ":bear", Def: target}
			r.emit("transform", owner, &p.Rows[row][i], row, false, c)
		}
	}
}

// Resolve a placement using the source card owner (different from row owner
// when the card is a spy). All Musters, including resurrected ones, call this.
func (r *Room) onPlaced(owner int, card Card, row string, c Catalog) {
	d := c[card.Def]
	if d.Has("spy") {
		r.draw(owner, 2, c)
	}
	if d.Has("mardroeme") {
		r.applyMardroeme(owner, row, c)
	}
	if d.Has("muster") {
		key := d.Muster
		if key == "" {
			key = strings.TrimSpace(strings.SplitN(d.Name, "-", 2)[0])
		}
		p := &r.Players[owner]
		var summoned []Card
		for _, pile := range []*[]Card{&p.Hand, &p.Deck} {
			for i := 0; i < len(*pile); {
				next := (*pile)[i]
				def := c[next.Def]
				if strings.HasPrefix(def.Name, key) && next.UID != card.UID {
					*pile = append((*pile)[:i], (*pile)[i+1:]...)
					summoned = append(summoned, next)
				} else {
					i++
				}
			}
		}
		// Placement must trigger the summoned card's OWN effects as in
		// original Board.addCardToRow(), rather than silently placing units.
		for _, next := range summoned {
			def := c[next.Def]
			summonRow := def.Row
			if summonRow == "agile" {
				summonRow = row
			}
			destination := owner
			if def.Has("spy") {
				destination = 1 - owner
			}
			r.place(destination, next, summonRow, c)
			r.onPlaced(owner, next, summonRow, c)
		}
	}
	// A Dimun Pirate carries global Scorch on a unit. The original effect
	// temporarily excludes its own source from the list of strongest units.
	if d.Has("scorch") {
		r.destroyStrongestExcept(c, -1, "", 0, card.UID)
	}
	if d.Has("scorch_c") {
		r.destroyStrongest(c, 1-owner, "close", 10)
	}
	if d.Has("scorch_r") {
		r.destroyStrongest(c, 1-owner, "ranged", 10)
	}
	if d.Has("scorch_s") {
		r.destroyStrongest(c, 1-owner, "siege", 10)
	}
}

// Avenger units produce a different card on removal, including when a round ends.
// Replacement cards should not be silently removed by the same removal sweep.
func (r *Room) removeUnit(owner int, card Card, row string, c Catalog) {
	r.Players[owner].Grave = append(r.Players[owner].Grave, card)
	r.emit("destroyed", owner, &card, row, false, c)
	r.triggerRemoved(owner, card, c)
}

// Legacy Row.removeCard invokes removal abilities regardless of destination:
// a Decoy returning Cow/Kambi to hand still spawns its Avenger replacement.
// Returning the original unit to hand must not also put it in the graveyard.
func (r *Room) triggerRemoved(owner int, card Card, c Catalog) {
	d := c[card.Def]
	replacement := -1
	if d.Has("avenger") {
		replacement = c.Find("Bovine Defense Force")
	}
	if d.Has("avenger_kambi") {
		replacement = c.Find("Hemdall")
	}
	if replacement >= 0 && replacement < len(c) {
		fresh := Card{UID: r.effectUID(), Def: replacement}
		r.place(owner, fresh, "close", c)
		r.note(d.RussianName() + " призвал " + c[replacement].RussianName())
	}
}

// Cards that remain in Special stay on the board and are sent to the graveyard
// when the round ends. Row.Special is distinct from a leader's virtual horn.
func (r *Room) rowSpecial(player int, row string) []Card {
	if r.Players[player].Special == nil {
		return nil
	}
	return r.Players[player].Special[row]
}

func (r *Room) revealOpponentHand(player int, c Catalog) {
	opp := append([]Card(nil), r.Players[1-player].Hand...)
	r.shuffle(opp)
	r.Players[player].Peek = opp[:min(3, len(opp))]
}

func (r *Room) leaderTakeFromGrave(player int, target string, own bool, c Catalog) error {
	from := player
	if !own {
		from = 1 - player
	}
	options := r.eligibleGrave(from, c)
	if len(options) == 0 {
		// Legacy Emhyr and Eredin consume their ability even when the
		// graveyard has nothing eligible to take. A forged non-empty target
		// is still invalid and must never consume the leader.
		if target == "" {
			return nil
		}
		return errors.New("graveyard contains no eligible unit")
	}
	if target == "" {
		return errors.New("choose a card from the graveyard")
	}
	// Invader only randomizes returns to the battlefield. Returning to a
	// hand still requires the exact legal card chosen by this leader.
	found := false
	for _, card := range options {
		if card.UID == target {
			found = true
			break
		}
	}
	if !found {
		return errors.New("choose an eligible card from the graveyard")
	}
	card, ok := take(&r.Players[from].Grave, target)
	if !ok {
		return errors.New("graveyard card is no longer available")
	}
	r.Players[player].Hand = append(r.Players[player].Hand, card)
	return nil
}

func (r *Room) destroyerSwap(player int, targets []string, draw string) error {
	p := &r.Players[player]
	if len(targets) != 2 || targets[0] == targets[1] || draw == "" {
		return errors.New("select two distinct cards to discard and one card to draw")
	}
	found := 0
	for _, card := range p.Hand {
		if card.UID == targets[0] || card.UID == targets[1] {
			found++
		}
	}
	if found != 2 {
		return errors.New("discard target is not in hand")
	}
	canDraw := false
	for _, card := range p.Deck {
		if card.UID == draw {
			canDraw = true
		}
	}
	if !canDraw {
		return errors.New("draw target is not in deck")
	}
	for _, uid := range targets {
		card, _ := take(&p.Hand, uid)
		p.Grave = append(p.Grave, card)
	}
	card, _ := take(&p.Deck, draw)
	p.Hand = append(p.Hand, card)
	return nil
}

// The original Francesca Hope ability searches every assignment of agile
// units to Close / Ranged and selects the global maximum (ties prefer Close).
// Exhaustive search is bounded to avoid exponential request-time DoS for
// deliberately oversized custom games. Normal original decks stay exact.
func (r *Room) optimalAgile(player int, c Catalog) {
	p := &r.Players[player]
	var agile []Card
	var fixedClose, fixedRanged []Card
	for _, card := range p.Rows["close"] {
		if c[card.Def].Row == "agile" {
			agile = append(agile, card)
		} else {
			fixedClose = append(fixedClose, card)
		}
	}
	for _, card := range p.Rows["ranged"] {
		if c[card.Def].Row == "agile" {
			agile = append(agile, card)
		} else {
			fixedRanged = append(fixedRanged, card)
		}
	}
	n := len(agile)
	if n == 0 {
		return
	}
	if n > 18 {
		r.optimalAgileGreedy(player, c)
		return
	}
	maxScore := -1
	bestMask := 0
	for mask := 0; mask < (1 << n); mask++ {
		closeCards := append([]Card(nil), fixedClose...)
		rangedCards := append([]Card(nil), fixedRanged...)
		for i, card := range agile {
			if mask&(1<<(n-1-i)) == 0 {
				closeCards = append(closeCards, card)
			} else {
				rangedCards = append(rangedCards, card)
			}
		}
		p.Rows["close"] = closeCards
		p.Rows["ranged"] = rangedCards
		score := r.rowPower(player, "close", c) + r.rowPower(player, "ranged", c)
		if score > maxScore {
			maxScore = score
			bestMask = mask
		}
	}
	p.Rows["close"] = append([]Card(nil), fixedClose...)
	p.Rows["ranged"] = append([]Card(nil), fixedRanged...)
	for i, card := range agile {
		if bestMask&(1<<(n-1-i)) == 0 {
			p.Rows["close"] = append(p.Rows["close"], card)
		} else {
			p.Rows["ranged"] = append(p.Rows["ranged"], card)
		}
	}
}

func (r *Room) optimalAgileGreedy(player int, c Catalog) {

	// Deterministic hill-climbing. Recompute strengths, not printed base power.
	for step := 0; step < 32; step++ {
		bestGain := 0
		var best Card
		var src, dst string
		for _, row := range []string{"close", "ranged"} {
			other := "close"
			if row == "close" {
				other = "ranged"
			}
			for _, card := range r.Players[player].Rows[row] {
				if c[card.Def].Row != "agile" {
					continue
				}
				before := r.Score(player, c)
				sim := r.simulation()
				srcCards := sim.Players[player].Rows[row]
				taken, ok := take(&srcCards, card.UID)
				if !ok {
					continue
				}
				sim.Players[player].Rows[row] = srcCards
				sim.Players[player].Rows[other] = append(sim.Players[player].Rows[other], taken)
				diff := sim.Score(player, c) - before
				if diff > bestGain {
					bestGain = diff
					best = card
					src = row
					dst = other
				}
			}
		}
		if bestGain <= 0 {
			return
		}
		cards := r.Players[player].Rows[src]
		taken, _ := take(&cards, best.UID)
		r.Players[player].Rows[src] = cards
		r.Players[player].Rows[dst] = append(r.Players[player].Rows[dst], taken)
	}
}

func isWeather(d Definition) bool {
	return d.Deck == "weather" || strings.Contains(d.Ability, "clear") && d.Row == "weather"
}

// The weather row is public. Duplicate weather of the same kind immediately
// enters its owner's graveyard, as in the original Weather.addCard.
func (r *Room) playWeather(owner int, card Card, c Catalog) {
	defer func() { r.emit("weather", owner, &card, "", false, c) }()
	d := c[card.Def]
	if d.Has("clear") {
		r.clearWeather()
		r.Players[owner].Grave = append(r.Players[owner].Grave, card)
		return
	}
	for _, played := range r.WeatherCards {
		if c[played.Card.Def].Name == d.Name {
			r.Players[owner].Grave = append(r.Players[owner].Grave, card)
			return
		}
	}
	r.WeatherCards = append(r.WeatherCards, WeatherPlacement{Card: card, Owner: owner})
	for _, ability := range []string{"frost", "fog", "rain", "storm"} {
		if d.Has(ability) {
			r.Weather = append(r.Weather, ability)
		}
	}
}

func (r *Room) clearWeather() {
	for _, placed := range r.WeatherCards {
		if placed.Owner >= 0 && placed.Owner < len(r.Players) {
			r.Players[placed.Owner].Grave = append(r.Players[placed.Owner].Grave, placed.Card)
		}
	}
	r.WeatherCards = nil
	r.Weather = nil
}
