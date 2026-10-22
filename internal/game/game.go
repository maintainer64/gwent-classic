package game

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"time"
)

const RoomLifetime = 24 * time.Hour

var Factions = []string{"realms", "nilfgaard", "monsters", "scoiatael", "skellige"}
var ErrInvalid = errors.New("invalid move")

// The original card catalogue is imported without running its browser-side JavaScript.
type Definition struct {
	Name     string `json:"name"`
	NameRu   string `json:"nameRu"`
	Key      string `json:"key"`
	Deck     string `json:"deck"`
	Row      string `json:"row"`
	Strength string `json:"strength"`
	Ability  string `json:"ability"`
	Filename string `json:"filename"`
	Count    string `json:"count"`
	Muster   string `json:"muster"`
}
type Catalog []Definition

func ParseLegacyCards(source []byte) (Catalog, error) {
	var parts []string
	for _, line := range strings.Split(string(source), "\n") {
		line = strings.TrimSpace(line)
		line = strings.TrimPrefix(line, "+")
		line = strings.TrimSpace(line)
		if len(line) < 2 || line[0] != '\'' || line[len(line)-1] != '\'' {
			continue
		}
		// In the legacy file an escaped apostrophe is the only JS-specific escape.
		parts = append(parts, strings.ReplaceAll(line[1:len(line)-1], `\'`, `'`))
	}
	if len(parts) == 0 {
		return nil, errors.New("no card definitions")
	}
	var out Catalog
	if err := json.Unmarshal([]byte(strings.Join(parts, "")), &out); err != nil {
		return nil, fmt.Errorf("parse card catalog: %w", err)
	}
	if len(out) == 0 {
		return nil, errors.New("empty card catalog")
	}
	return out, nil
}
func (d Definition) Power() int  { n, _ := strconv.Atoi(d.Strength); return n }
func (d Definition) Copies() int { n, _ := strconv.Atoi(d.Count); return n }
func (d Definition) Has(ability string) bool {
	for _, a := range strings.Fields(d.Ability) {
		if a == ability {
			return true
		}
	}
	return false
}
func (c Catalog) Find(name string) int {
	for i, d := range c {
		if d.Name == name {
			return i
		}
	}
	return -1
}
func (c Catalog) Valid() error {
	if len(c) < 20 {
		return errors.New("not enough cards")
	}
	return nil
}

// All original leader cards are selectable; their effects are resolved on Go.
// Passive powers are enabled when the game starts.
var supportedLeaders = map[string]string{
	"foltest_king":            "Сыграть туман из своей колоды",
	"foltest_lord":            "Очистить погоду",
	"foltest_siegemaster":     "Удвоить осадный ряд",
	"foltest_steelforged":     "Казнь осадного ряда противника",
	"foltest_son":             "Казнь дальнего ряда противника",
	"emhyr_imperial":          "Сыграть дождь из своей колоды",
	"emhyr_whiteflame":        "Пассивно блокирует лидера противника",
	"emhyr_emperor":           "Посмотреть три карты противника",
	"emhyr_relentless":        "Взять карту из сброса противника",
	"emhyr_invader":           "Возрождение случайной карты для обоих игроков",
	"eredin_commander":        "Удвоить ближний ряд",
	"eredin_bringer_of_death": "Вернуть отряд из собственного сброса в руку",
	"eredin_destroyer":        "Сбросить две карты и выбрать одну из колоды",
	"eredin_king":             "Сыграть погодную карту из своей колоды",
	"eredin_treacherous":      "Пассивно удвоить силу шпионов",
	"francesca_queen":         "Казнь ближнего ряда противника",
	"francesca_beautiful":     "Удвоить дальний ряд",
	"francesca_daisy":         "Пассивно получить дополнительную карту в начале",
	"francesca_pureblood":     "Сыграть мороз из своей колоды",
	"francesca_hope":          "Переместить гибкие отряды в наиболее выгодные ряды",
	"crach_an_craite":         "Вернуть карты из сброса в колоды обоих игроков",
	"king_bran":               "Пассивно уменьшить урон от погоды",
}

type LeaderOption struct {
	ID            int    `json:"id"`
	Key           string `json:"key"`
	NameRu        string `json:"nameRu"`
	Image         string `json:"image"`
	Name          string `json:"name"`
	Faction       string `json:"faction"`
	Ability       string `json:"ability"`
	Description   string `json:"description"`
	DescriptionEn string `json:"descriptionEn"`
	Passive       bool   `json:"passive"`
}

func LeaderOptions(c Catalog) []LeaderOption {
	out := []LeaderOption{}
	for i, d := range c {
		if d.Row != "leader" {
			continue
		}
		for _, a := range strings.Fields(d.Ability) {
			desc, ok := supportedLeaders[a]
			if !ok {
				continue
			}
			passive := a == "emhyr_whiteflame" || a == "eredin_treacherous" || a == "francesca_daisy" || a == "king_bran" || a == "emhyr_invader"
			out = append(out, LeaderOption{ID: i + 1, Key: d.StableKey(), NameRu: d.RussianName(), Image: d.Artwork(), Name: d.Name, Faction: d.Deck, Ability: a, Description: desc, DescriptionEn: d.DescriptionEn(), Passive: passive})
			break
		}
	}
	return out
}

// DeckCatalog is metadata only; the hidden actual deck and order are not exposed.
type DeckCard struct {
	ID            int    `json:"id"`
	Key           string `json:"key"`
	NameRu        string `json:"nameRu"`
	Description   string `json:"description"`
	DescriptionEn string `json:"descriptionEn"`
	Name          string `json:"name"`
	Faction       string `json:"faction"`
	Row           string `json:"row"`
	Power         int    `json:"power"`
	Ability       string `json:"ability"`
	MaxCopies     int    `json:"maxCopies"`
	Image         string `json:"image"`
}

func DeckCatalog(c Catalog) []DeckCard {
	result := []DeckCard{}
	for i, d := range c {
		if d.Copies() == 0 || d.Row == "leader" {
			continue
		}
		result = append(result, DeckCard{ID: i, Key: d.StableKey(), NameRu: d.RussianName(), Description: d.Description(), DescriptionEn: d.DescriptionEn(), Name: d.Name, Faction: d.Deck, Row: d.Row, Power: d.Power(), Ability: d.Ability, MaxCopies: d.Copies(), Image: d.Artwork()})
	}
	return result
}

type Card struct {
	UID   string `json:"uid"`
	Def   int    `json:"def"`
	Boost int    `json:"boost,omitempty"`
}

// Played weather cards occupy the shared weather row until clear or round end.
// Owner is necessary to return each physical card to the correct graveyard.
type WeatherPlacement struct {
	Card  Card `json:"card"`
	Owner int  `json:"owner"`
}

// Bot settings are fixed when the room is created and persisted alongside the match.
type BotDifficulty string

const (
	BotEasy   BotDifficulty = "easy"
	BotNormal BotDifficulty = "normal"
	BotHard   BotDifficulty = "hard"
)

type BotDeckMode string

const (
	BotRandom  BotDeckMode = "random"
	BotFaction BotDeckMode = "faction"
	BotCustom  BotDeckMode = "custom"
)

type DeckEntry struct {
	Def   int    `json:"def"` // zero-based legacy catalog index
	Count int    `json:"count"`
	Key   string `json:"key,omitempty"`
}
type BotOptions struct {
	Style      string        `json:"style,omitempty"`
	Leader     int           `json:"leader,omitempty"`
	Difficulty BotDifficulty `json:"difficulty"`
	DeckMode   BotDeckMode   `json:"deckMode"`
	Faction    string        `json:"faction,omitempty"`
	Deck       []DeckEntry   `json:"deck,omitempty"`
}

func (o BotOptions) normalize() (BotOptions, error) {
	if o.Style == "" {
		o.Style = "balanced"
	}
	if o.Style != "balanced" && o.Style != "aggressive" && o.Style != "economy" {
		return o, errors.New("invalid bot style")
	}
	if o.Difficulty == "" {
		o.Difficulty = BotNormal
	}
	if o.DeckMode == "" {
		o.DeckMode = BotRandom
	}
	if o.Difficulty != BotEasy && o.Difficulty != BotNormal && o.Difficulty != BotHard {
		return o, errors.New("invalid bot difficulty")
	}
	if o.DeckMode != BotRandom && o.DeckMode != BotFaction && o.DeckMode != BotCustom {
		return o, errors.New("invalid bot deck mode")
	}
	if o.DeckMode == BotRandom {
		if o.Leader != 0 {
			return o, errors.New("random bot cannot set leader")
		}
		if o.Faction != "" || len(o.Deck) > 0 {
			return o, errors.New("random bot cannot set faction or deck")
		}
		o.Faction = Factions[randomInt(len(Factions))]
	} else {
		if !validFaction(o.Faction) {
			return o, errors.New("invalid bot faction")
		}
		if o.DeckMode == BotFaction && len(o.Deck) > 0 {
			return o, errors.New("faction bot cannot set custom deck")
		}
		if o.DeckMode == BotCustom && len(o.Deck) == 0 {
			return o, errors.New("custom deck is empty")
		}
	}
	return o, nil
}

// ValidateDeck rejects unknown IDs, unavailable duplicates and faction mismatches.
func ValidateDeck(c Catalog, faction string, entries []DeckEntry) error {
	resolved, err := ResolveDeck(c, entries)
	if err != nil {
		return err
	}
	entries = resolved
	if !validFaction(faction) || len(entries) == 0 || len(entries) > len(c) {
		return errors.New("invalid custom deck")
	}
	units, specials, total := 0, 0, 0
	seen := make(map[int]bool, len(entries))
	for _, e := range entries {
		if e.Def < 0 || e.Def >= len(c) || seen[e.Def] {
			return errors.New("duplicate or unknown card definition")
		}
		seen[e.Def] = true
		d := c[e.Def]
		if e.Count <= 0 || e.Count > d.Copies() || e.Count > 10 || d.Row == "leader" {
			return errors.New("invalid card count")
		}
		if d.Deck != faction && d.Deck != "neutral" && d.Deck != "special" && d.Deck != "weather" {
			return errors.New("card is outside selected faction")
		}
		total += e.Count
		if d.Deck == "special" || d.Deck == "weather" {
			specials += e.Count
		} else {
			units += e.Count
		}
	}
	if units < 22 || specials > 10 {
		return fmt.Errorf("deck needs >=22 units and <=10 specials (got %d units, %d specials, %d total)", units, specials, total)
	}
	return nil
}
func assignCustomDeck(p *Player, c Catalog, faction string, deck []DeckEntry) error {
	if deck == nil { // Legacy API clients may continue using a generated deck.
		return nil
	}
	resolved, err := ResolveDeck(c, deck)
	if err != nil {
		return err
	}
	deck = resolved
	if err := ValidateDeck(c, faction, deck); err != nil {
		return err
	}
	p.Deck = make([]Card, 0)
	for _, e := range deck {
		for n := 0; n < e.Count; n++ {
			p.Deck = append(p.Deck, Card{UID: randomUID(), Def: e.Def})
		}
	}
	shuffle(p.Deck)
	return nil
}

func (o BotOptions) makePlayer(c Catalog) (Player, error) {
	p, err := addPlayer("BOT", "Бот", o.Faction, c, o.Leader)
	if err != nil {
		return Player{}, err
	}
	if o.DeckMode == BotCustom {
		if err := assignCustomDeck(&p, c, o.Faction, o.Deck); err != nil {
			return Player{}, err
		}
	}
	return p, nil
}

type Player struct {
	ID         string            `json:"id"`
	Name       string            `json:"name"`
	Faction    string            `json:"faction"`
	Leader     int               `json:"leader"`
	Deck       []Card            `json:"deck"`
	Hand       []Card            `json:"hand"`
	Grave      []Card            `json:"grave"`
	Rows       map[string][]Card `json:"rows"`
	Horn       map[string]bool   `json:"horn"`
	Mardroeme  map[string]bool   `json:"mardroeme"`
	Special    map[string][]Card `json:"special"`
	Peek       []Card            `json:"peek,omitempty"`
	Passed     bool              `json:"passed"`
	Wins       int               `json:"wins"`
	LeaderUsed bool              `json:"leaderUsed"`
	Ready      bool              `json:"ready"`
	Redraws    int               `json:"redraws"`
}

// An immutable per-round score record, used by the original victory screen.
type RoundResult struct {
	ScoreA int `json:"scoreA"`
	ScoreB int `json:"scoreB"`
	Winner int `json:"winner"`
}
type Room struct {
	Code          string             `json:"code"`
	Mode          string             `json:"mode"`
	Bot           *BotOptions        `json:"bot,omitempty"`
	Timer         *TurnTimer         `json:"timer,omitempty"`
	Status        string             `json:"status"`
	Phase         string             `json:"phase,omitempty"`
	Version       int                `json:"version"`
	CreatedAt     time.Time          `json:"createdAt"`
	ExpiresAt     time.Time          `json:"expiresAt"`
	TurnDeadline  time.Time          `json:"turnDeadline,omitempty"`
	Players       []Player           `json:"players"`
	Turn          int                `json:"turn"`
	Initiative    int                `json:"initiative"`
	PendingOwner  int                `json:"pendingOwner,omitempty"`
	Round         int                `json:"round"`
	RoundHistory  []RoundResult      `json:"roundHistory,omitempty"`
	Winner        int                `json:"winner"`
	Weather       []string           `json:"weather"`
	WeatherCards  []WeatherPlacement `json:"weatherCards,omitempty"`
	RoundStarter  int                `json:"roundStarter"`
	Events        []string           `json:"events"`
	Serial        int                `json:"serial"`
	EventSeq      int                `json:"eventSeq"`
	Transitions   []MatchEvent       `json:"transitions,omitempty"`
	simulating    bool
	clearingRound bool
}
type Action struct {
	Type      string   `json:"type"`
	UID       string   `json:"uid"`
	Row       string   `json:"row"`
	Target    string   `json:"target"`
	Targets   []string `json:"targets,omitempty"`
	Draw      string   `json:"draw,omitempty"`
	TargetRow string   `json:"targetRow,omitempty"`
}

func (r *Room) note(msg string) {
	r.Events = append(r.Events, msg)
	if len(r.Events) > 25 {
		r.Events = r.Events[len(r.Events)-25:]
	}
}
func randomInt(n int) int {
	if n <= 1 {
		return 0
	}
	v, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		panic(err)
	}
	return int(v.Int64())
}
func randomUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func shuffle(cards []Card) {
	for i := len(cards) - 1; i > 0; i-- {
		j := randomInt(i + 1)
		cards[i], cards[j] = cards[j], cards[i]
	}
}
func validFaction(s string) bool {
	for _, v := range Factions {
		if s == v {
			return true
		}
	}
	return false
}
func rows() map[string][]Card { return map[string][]Card{"close": {}, "ranged": {}, "siege": {}} }
func addPlayer(id, name, faction string, c Catalog, selectedLeader ...int) (Player, error) {
	if !validFaction(faction) {
		return Player{}, fmt.Errorf("unknown faction")
	}
	p := Player{ID: id, Name: name, Faction: faction, Rows: rows(), Horn: map[string]bool{}, Mardroeme: map[string]bool{}, Special: rows()}
	units, specials := []Card{}, []Card{}
	for i, d := range c {
		if d.Deck != faction && d.Deck != "neutral" && d.Deck != "special" && d.Deck != "weather" {
			continue
		}
		if d.Row == "leader" {
			if d.Deck == faction && p.Leader == 0 {
				p.Leader = i + 1
			}
			continue
		}
		for copy := 0; copy < d.Copies(); copy++ {
			card := Card{UID: randomUID(), Def: i}
			if d.Deck == "special" || d.Deck == "weather" {
				specials = append(specials, card)
			} else {
				units = append(units, card)
			}
		}
	}
	if len(selectedLeader) > 0 && selectedLeader[0] != 0 {
		id := selectedLeader[0]
		allowed := false
		for _, option := range LeaderOptions(c) {
			if option.ID == id && option.Faction == faction {
				allowed = true
				break
			}
		}
		if !allowed {
			return Player{}, errors.New("unsupported leader for selected faction")
		}
		p.Leader = id
	}
	// Strong enough to play a complete three-round match; specials at most ten.
	shuffle(units)
	shuffle(specials)
	if len(units) < 22 {
		return Player{}, fmt.Errorf("insufficient cards in %s", faction)
	}
	n := min(len(units), 27)
	p.Deck = append(p.Deck, units[:n]...)
	p.Deck = append(p.Deck, specials[:min(len(specials), 8)]...)
	shuffle(p.Deck)
	return p, nil
}
func NewRoom(code, mode, id, name, faction string, c Catalog, now time.Time, selectedLeader ...int) (*Room, error) {
	return NewRoomConfigured(code, mode, id, name, faction, c, now, 0, botDefaults(), selectedLeader...)
}
func botDefaults() BotOptions { return BotOptions{Difficulty: BotNormal, DeckMode: BotRandom} }
func NewRoomConfigured(code, mode, id, name, faction string, c Catalog, now time.Time, botLeader int, botOptions BotOptions, selectedLeader ...int) (*Room, error) {
	return NewRoomWithDeck(code, mode, id, name, faction, c, now, botLeader, botOptions, nil, selectedLeader...)
}

// NewRoomWithDeck accepts the original deck editor's selected cards. The browser
// only submits definition IDs and counts; ownership, faction and limits are
// checked server-side before the first hand is dealt.
func NewRoomWithDeck(code, mode, id, name, faction string, c Catalog, now time.Time, botLeader int, botOptions BotOptions, deck []DeckEntry, selectedLeader ...int) (*Room, error) {
	if mode != "bot" && mode != "pvp" {
		return nil, errors.New("invalid mode")
	}
	p, err := addPlayer(id, name, faction, c, selectedLeader...)
	if err != nil {
		return nil, err
	}
	if err := assignCustomDeck(&p, c, faction, deck); err != nil {
		return nil, err
	}
	r := &Room{Code: code, Mode: mode, Status: "waiting", CreatedAt: now.UTC(), ExpiresAt: now.UTC().Add(RoomLifetime), Players: []Player{p}, Winner: -1}
	if mode == "bot" {
		option, err := botOptions.normalize()
		if err != nil {
			return nil, err
		}
		bot, err := option.makePlayer(c)
		if err != nil {
			return nil, err
		}
		if botLeader != 0 { // Optional supported leader from the bot faction.
			valid := false
			for _, o := range LeaderOptions(c) {
				if o.ID == botLeader && o.Faction == option.Faction {
					valid = true
					break
				}
			}
			if !valid {
				return nil, errors.New("invalid bot leader")
			}
			bot.Leader = botLeader
		}
		r.Bot = &option
		r.Players = append(r.Players, bot)
		r.start(c)
	}
	return r, nil
}
func (r *Room) Join(id, name, faction string, c Catalog, selectedLeader ...int) error {
	return r.JoinWithDeck(id, name, faction, c, nil, selectedLeader...)
}

func (r *Room) JoinWithDeck(id, name, faction string, c Catalog, deck []DeckEntry, selectedLeader ...int) error {
	if r.Mode != "pvp" || r.Status != "waiting" || len(r.Players) != 1 {
		return errors.New("room is not accepting players")
	}
	if id == r.Players[0].ID {
		return errors.New("already joined")
	}
	p, err := addPlayer(id, name, faction, c, selectedLeader...)
	if err != nil {
		return err
	}
	if err := assignCustomDeck(&p, c, faction, deck); err != nil {
		return err
	}
	r.Players = append(r.Players, p)
	r.start(c)
	return nil
}
func (r *Room) start(c Catalog) {
	r.Status = "playing"
	r.Phase = "mulligan"
	r.Round = 1
	if r.leadersNullified(c) {
		for i := range r.Players {
			r.Players[i].LeaderUsed = true
		}
	}
	r.Turn = randomInt(2)
	r.RoundStarter = r.Turn
	r.Initiative = 0
	if r.Players[0].Faction == "scoiatael" && r.Players[1].Faction != "scoiatael" {
		r.Initiative = 1
	}
	if r.Players[1].Faction == "scoiatael" && r.Players[0].Faction != "scoiatael" {
		r.Initiative = 2
	}
	if r.Mode == "bot" && r.Initiative == 2 {
		r.Turn = randomInt(2)
		r.Initiative = 0
	}
	for i := range r.Players {
		r.Players[i].Redraws = 2
		r.Players[i].Ready = false
		count := 10
		if r.leaderHas(i, c, "francesca_daisy") {
			count++
		}
		r.draw(i, count, c)
	}
	if r.Mode == "bot" {
		// A bot redraws up to two low-value cards; it never skips the opening
		// redraw phase or sees its opponent's hand.
		for n := 0; n < 2; n++ {
			bot := &r.Players[1]
			if len(bot.Deck) == 0 || len(bot.Hand) == 0 {
				break
			}
			weakest := bot.Hand[0]
			for _, card := range bot.Hand {
				if c[card.Def].Power() < c[weakest.Def].Power() {
					weakest = card
				}
			}
			_ = r.redraw(1, weakest.UID, c)
		}
		r.Players[1].Ready = true
	}
	r.note("Матч начался")
	r.Bots(c)
}
func (r *Room) draw(player, n int, c Catalog) {
	p := &r.Players[player]
	for n > 0 && len(p.Deck) > 0 {
		last := len(p.Deck) - 1
		p.Hand = append(p.Hand, p.Deck[last])
		p.Deck = p.Deck[:last]
		drawn := p.Hand[len(p.Hand)-1]
		r.emit("draw", player, &drawn, "", true, c)
		n--
	}
}
func take(cards *[]Card, uid string) (Card, bool) {
	for i, card := range *cards {
		if card.UID == uid {
			*cards = append((*cards)[:i], (*cards)[i+1:]...)
			return card, true
		}
	}
	return Card{}, false
}

// unitPowers returns effective card strengths after weather, bond, horn and morale.
// Scorch and scoreboard must use the SAME strengths or clients see impossible moves.
// unitPowers reproduces the exact ordering from the original Row.calcCardScore:
// printed strength -> weather -> spy -> tight bond -> morale -> horn.
// Decoys are battlefield placeholders, not scoring or scorchable units.
func (r *Room) unitPowers(player int, row string, c Catalog) map[string]int {
	p := r.Players[player]
	cards := p.Rows[row]
	strengths := make(map[string]int, len(cards))
	groups := map[string]int{}
	morale := 0
	hornCount := 0
	for _, card := range cards {
		d := c[card.Def]
		if d.Has("decoy") || d.Deck == "special" || d.Deck == "weather" {
			continue
		}
		if d.Has("bond") {
			groups[d.Name]++
		}
		if d.Has("morale") {
			morale++
		}
		if d.Has("horn") {
			hornCount++
		}
	}
	if p.Horn[row] {
		hornCount++
	}
	badWeather := false
	for _, w := range r.Weather {
		if (row == "close" && w == "frost") || (row == "ranged" && (w == "fog" || w == "storm")) || (row == "siege" && (w == "rain" || w == "storm")) {
			badWeather = true
		}
	}
	doubleSpy := r.leaderHas(0, c, "eredin_treacherous") || r.leaderHas(1, c, "eredin_treacherous")
	for _, card := range cards {
		d := c[card.Def]
		if d.Has("decoy") || d.Deck == "special" || d.Deck == "weather" {
			strengths[card.UID] = 0
			continue
		}
		power := d.Power() + card.Boost
		if !d.Has("hero") {
			if badWeather {
				maximum := 1
				if r.leaderHas(player, c, "king_bran") {
					maximum = power / 2 // original uses Math.floor(basePower / 2)
				}
				if power > maximum {
					power = maximum
				}
			}
			if doubleSpy && d.Has("spy") {
				power *= 2
			}
			if d.Has("bond") && groups[d.Name] > 1 {
				power *= groups[d.Name]
			}
			bonus := morale
			if d.Has("morale") {
				bonus--
			}
			if bonus > 0 {
				power += bonus
			}
			horns := hornCount
			if d.Has("horn") {
				horns-- // a horn does not double itself
			}
			if horns > 0 {
				power *= 2
			}
		}
		strengths[card.UID] = power
	}
	return strengths
}
func (r *Room) rowPower(player int, row string, c Catalog) int {
	total := 0
	for _, power := range r.unitPowers(player, row, c) {
		total += power
	}
	return total
}

// Raw leader identity must be inspectable even after its power is disabled.
func (r *Room) rawLeaderHas(player int, c Catalog, ability string) bool {
	if player < 0 || player >= len(r.Players) {
		return false
	}
	p := r.Players[player]
	return p.Leader > 0 && p.Leader <= len(c) && c[p.Leader-1].Has(ability)
}

// Emhyr's White Flame cancels BOTH leaders, including all passive powers,
// matching Game.initPlayers in the original JavaScript engine.
func (r *Room) leadersNullified(c Catalog) bool {
	return r.rawLeaderHas(0, c, "emhyr_whiteflame") || r.rawLeaderHas(1, c, "emhyr_whiteflame")
}

func (r *Room) leaderHas(player int, c Catalog, ability string) bool {
	return !r.leadersNullified(c) && r.rawLeaderHas(player, c, ability)
}
func (r *Room) Score(player int, c Catalog) int {
	return r.rowPower(player, "close", c) + r.rowPower(player, "ranged", c) + r.rowPower(player, "siege", c)
}
func validRow(d Definition, row string) bool {
	if d.Row == "agile" {
		return row == "close" || row == "ranged"
	}
	if d.Deck == "special" && (d.Has("horn") || d.Has("mardroeme")) {
		return row == "close" || row == "ranged" || row == "siege"
	}
	return d.Row == row
}
func (r *Room) place(player int, card Card, row string, c Catalog) {
	if c[card.Def].Has("berserker") && r.Players[player].Mardroeme[row] {
		target := 206
		if strings.Contains(c[card.Def].Name, "Young") {
			target = 207
		}
		if target < len(c) {
			card.Def = target
		}
	}
	r.Players[player].Rows[row] = append(r.Players[player].Rows[row], card)
	r.emit("placed", player, &card, row, false, c)
}
func (r *Room) destroyStrongest(c Catalog, onlyPlayer int, onlyRow string, threshold int) {
	r.destroyStrongestExcept(c, onlyPlayer, onlyRow, threshold, "")
}
func (r *Room) destroyStrongestExcept(c Catalog, onlyPlayer int, onlyRow string, threshold int, excludedUID string) {
	best := -1
	targets := map[string]bool{}
	for i := range r.Players {
		if onlyPlayer >= 0 && i != onlyPlayer {
			continue
		}
		for _, row := range []string{"close", "ranged", "siege"} {
			if onlyRow != "" && onlyRow != row {
				continue
			}
			if threshold > 0 && r.rowPower(i, row, c) < threshold {
				continue
			}
			strengths := r.unitPowers(i, row, c)
			for _, card := range r.Players[i].Rows[row] {
				if card.UID == excludedUID || !isUnit(c[card.Def]) {
					continue
				}
				power := strengths[card.UID]
				if power > best {
					best = power
					targets = map[string]bool{}
				}
				if power == best {
					targets[card.UID] = true
				}
			}
		}
	}
	if best < 0 {
		return
	}
	type removed struct {
		owner int
		card  Card
		row   string
	}
	removedCards := []removed{}
	for i := range r.Players {
		for _, row := range []string{"close", "ranged", "siege"} {
			kept := []Card{}
			for _, card := range r.Players[i].Rows[row] {
				if targets[card.UID] {
					removedCards = append(removedCards, removed{i, card, row})
				} else {
					kept = append(kept, card)
				}
			}
			r.Players[i].Rows[row] = kept
		}
	}
	// Finish the removal sweep before triggering Avenger; a freshly summoned
	// cow/hero must not disappear while iterating the original row slices.
	for _, x := range removedCards {
		r.removeUnit(x.owner, x.card, x.row, c)
	}
	r.note("Казнь уничтожает сильнейшие карты")
}
func (r *Room) play(player int, a Action, c Catalog) error {
	p := &r.Players[player]
	if p.Special == nil {
		p.Special = rows()
	} // migrate sessions created before Special existed
	var card Card
	found := false
	for _, x := range p.Hand {
		if x.UID == a.UID {
			card = x
			found = true
			break
		}
	}
	if !found {
		return errors.New("card not in hand")
	}
	d := c[card.Def]
	if d.Deck == "weather" {
		if !d.Has("clear") && !d.Has("frost") && !d.Has("fog") && !d.Has("rain") && !d.Has("storm") {
			return ErrInvalid
		}
	} else if d.Has("scorch") && d.Deck == "special" {
	} else if d.Has("decoy") {
		if a.Target == "" {
			return errors.New("select own unit to replace with Decoy")
		}
		ok := false
		for _, row := range []string{"close", "ranged", "siege"} {
			for _, x := range p.Rows[row] {
				if x.UID == a.Target && isUnit(c[x.Def]) {
					ok = true
				}
			}
		}
		if !ok {
			return errors.New("invalid decoy target")
		}
	} else if d.Has("mardroeme") && d.Deck == "special" {
		if !validRow(d, a.Row) || len(p.Special[a.Row]) != 0 || p.Horn[a.Row] {
			return errors.New("choose a row without special card for Mardroeme")
		}
	} else if d.Has("horn") && d.Deck == "special" {
		if !validRow(d, a.Row) || len(p.Special[a.Row]) != 0 || p.Horn[a.Row] {
			return errors.New("choose a row without horn")
		}
	} else if !validRow(d, a.Row) {
		return errors.New("invalid row")
	}
	if d.Has("medic") {
		if err := r.validateRevivePlacement(player, a.Target, a.TargetRow, c); err != nil {
			return err
		}
	}
	r.emit("played", player, &card, a.Row, false, c)
	_, _ = take(&p.Hand, card.UID)
	switch {
	case d.Deck == "weather":
		r.playWeather(player, card, c)
	case d.Has("scorch") && d.Deck == "special":
		p.Grave = append(p.Grave, card)
		r.destroyStrongest(c, -1, "", 0)
	case d.Has("decoy"):
		for _, row := range []string{"close", "ranged", "siege"} {
			current := p.Rows[row]
			if taken, ok := take(&current, a.Target); ok {
				p.Rows[row] = current
				p.Hand = append(p.Hand, taken)
				r.place(player, card, row, c) // Decoy physically occupies the freed battlefield slot.
				r.triggerRemoved(player, taken, c)
				break
			}
		}
	case d.Has("mardroeme") && d.Deck == "special":
		p.Special[a.Row] = append(p.Special[a.Row], card)
		r.applyMardroeme(player, a.Row, c)
	case d.Has("horn") && d.Deck == "special":
		p.Horn[a.Row] = true
		p.Special[a.Row] = append(p.Special[a.Row], card)
	default:
		destination := player
		if d.Has("spy") {
			destination = 1 - player
		}
		r.place(destination, card, a.Row, c)
		r.onPlaced(player, card, a.Row, c)
		if d.Has("medic") {
			r.resolveMedic(player, a.Target, a.TargetRow, c)
		}

	}
	r.note(p.Name + " сыграл(а): " + d.RussianName())
	r.emit("resolved", player, &card, a.Row, false, c)
	return nil
}
func (r *Room) finishRound(c Catalog) {
	a, b := r.Score(0, c), r.Score(1, c)
	winner := -1
	if a > b {
		winner = 0
	} else if b > a {
		winner = 1
	} else if r.Players[0].Faction == "nilfgaard" && r.Players[1].Faction != "nilfgaard" {
		winner = 0
	} else if r.Players[1].Faction == "nilfgaard" && r.Players[0].Faction != "nilfgaard" {
		winner = 1
	}
	r.RoundHistory = append(r.RoundHistory, RoundResult{ScoreA: a, ScoreB: b, Winner: winner})
	if winner == -1 {
		r.Players[0].Wins++
		r.Players[1].Wins++
		r.note(fmt.Sprintf("Раунд %d: ничья (%d:%d)", r.Round, a, b))
	} else {
		r.Players[winner].Wins++
		r.note(fmt.Sprintf("Раунд %d: %s победил (%d:%d)", r.Round, r.Players[winner].Name, a, b))
		if r.Players[winner].Faction == "realms" {
			r.draw(winner, 1, c)
		}
	}
	r.emit("round_end", winner, nil, "", false, c)
	finished := r.Players[0].Wins >= 2 || r.Players[1].Wins >= 2 || r.Round >= 3
	// Legacy Game.endRound always calls Board.clearRound before Game.endGame,
	// even on the last round: a finished match must not expose a full board.
	// The Monsters survivor and Avenger replacement rules still run on clear.
	if !finished {
		// Winning player starts the next round. A draw retains the old starter.
		if winner >= 0 {
			r.Turn = winner
		} else {
			r.Turn = r.RoundStarter
		}
		r.RoundStarter = r.Turn
		r.Round++
	}
	r.clearingRound = true
	for i := range r.Players {
		p := &r.Players[i]
		retain := Card{}
		retaining := false
		if p.Faction == "monsters" {
			all := []Card{}
			for _, row := range []string{"close", "ranged", "siege"} {
				for _, card := range p.Rows[row] {
					if isUnit(c[card.Def]) {
						all = append(all, card)
					}
				}
			}
			if len(all) > 0 {
				retain = all[randomInt(len(all))]
				retaining = true
			}
		}
		oldRows := p.Rows
		oldSpecial := p.Special
		p.Rows = rows()
		p.Special = rows()
		for _, row := range []string{"close", "ranged", "siege"} {
			p.Grave = append(p.Grave, oldSpecial[row]...)
		}
		for _, row := range []string{"close", "ranged", "siege"} {
			for _, card := range oldRows[row] {
				if retaining && card.UID == retain.UID {
					continue
				}
				r.removeUnit(i, card, row, c)
			}
		}
		if retaining {
			row := ""
			for _, candidate := range []string{"close", "ranged", "siege"} {
				// Preserve agile card's actual old row, not the default printed row.
				for _, old := range oldRows[candidate] {
					if old.UID == retain.UID {
						row = candidate
						break
					}
				}
			}
			if row == "" {
				row = "close"
			}
			p.Rows[row] = append(p.Rows[row], retain)
		}
		p.Horn = map[string]bool{}
		p.Mardroeme = map[string]bool{}
		p.Passed = false
	}
	r.clearWeather()
	r.clearingRound = false
	if finished {
		r.Status = "finished"
		r.Winner = -1
		if r.Players[0].Wins > r.Players[1].Wins {
			r.Winner = 0
		} else if r.Players[1].Wins > r.Players[0].Wins {
			r.Winner = 1
		}
		r.note("Матч завершён")
		r.emit("match_end", r.Winner, nil, "", false, c)
		return
	}
	// Original startRound() triggers Skellige AFTER all players' old rows
	// and weather have been cleared. Reviving a spy before the opponent's
	// row cleanup would immediately discard the newly spawned spy.
	if r.Round == 3 {
		for i := range r.Players {
			if r.Players[i].Faction != "skellige" {
				continue
			}
			for n := 0; n < 2; n++ {
				options := r.eligibleGrave(i, c)
				if len(options) == 0 {
					break
				}
				card := options[randomInt(len(options))]
				r.reviveTarget(i, card.UID, c)
			}
		}
	}
	r.note(fmt.Sprintf("Раунд %d", r.Round))
	r.emit("round_start", r.Turn, nil, "", false, c)
}

// activateLeader runs entirely on the server and consumes the player's turn.
func (r *Room) activateLeader(index int, a Action, c Catalog) error {
	p := &r.Players[index]
	if p.LeaderUsed || p.Leader == 0 || p.Leader > len(c) {
		return errors.New("leader is unavailable")
	}
	ability := ""
	for _, a := range strings.Fields(c[p.Leader-1].Ability) {
		if _, ok := supportedLeaders[a]; ok {
			ability = a
			break
		}
	}
	if ability == "" {
		return errors.New("unsupported leader")
	}
	if r.leadersNullified(c) {
		return errors.New("White Flame cancels both leaders")
	}
	optionPassive := map[string]bool{"emhyr_whiteflame": true, "eredin_treacherous": true, "francesca_daisy": true, "king_bran": true, "emhyr_invader": true}
	if optionPassive[ability] {
		return errors.New("this leader has a passive ability")
	}
	switch ability {
	case "emhyr_emperor":
		r.revealOpponentHand(index, c)
	case "emhyr_relentless":
		if err := r.leaderTakeFromGrave(index, a.Target, false, c); err != nil {
			return err
		}
	case "eredin_bringer_of_death":
		if err := r.leaderTakeFromGrave(index, a.Target, true, c); err != nil {
			return err
		}
	case "eredin_destroyer":
		if err := r.destroyerSwap(index, a.Targets, a.Draw); err != nil {
			return err
		}
	case "francesca_hope":
		r.optimalAgile(index, c)
	case "foltest_lord":
		r.clearWeather()
	case "foltest_siegemaster":
		// Legacy Row.leaderHorn is a no-op if ANY special card occupies the slot.
		if len(p.Special["siege"]) == 0 {
			p.Horn["siege"] = true
		}
	case "eredin_commander":
		if len(p.Special["close"]) == 0 {
			p.Horn["close"] = true
		}
	case "francesca_beautiful":
		if len(p.Special["ranged"]) == 0 {
			p.Horn["ranged"] = true
		}
	case "foltest_steelforged":
		r.destroyStrongest(c, 1-index, "siege", 10)
	case "foltest_son":
		r.destroyStrongest(c, 1-index, "ranged", 10)
	case "francesca_queen":
		r.destroyStrongest(c, 1-index, "close", 10)
	case "foltest_king", "emhyr_imperial", "francesca_pureblood", "eredin_king":
		chosen := -1
		for j, card := range p.Deck {
			d := c[card.Def]
			if d.Deck != "weather" {
				continue
			}
			ok := (ability == "eredin_king" && (a.Target == "" || a.Target == card.UID)) || (ability == "foltest_king" && d.Has("fog")) || (ability == "emhyr_imperial" && d.Has("rain")) || (ability == "francesca_pureblood" && d.Has("frost"))
			if ok {
				chosen = j
				break
			}
		}
		if chosen < 0 {
			// Original weather-search leaders consume their turn even if
			// their deck contains no weather card of the requested kind.
			if a.Target != "" {
				return errors.New("leader has no matching weather card in deck")
			}
		} else {
			card := p.Deck[chosen]
			p.Deck = append(p.Deck[:chosen], p.Deck[chosen+1:]...)
			r.playWeather(index, card, c)
		}
	case "crach_an_craite":
		for i := range r.Players {
			q := &r.Players[i]
			q.Deck = append(q.Deck, q.Grave...)
			q.Grave = nil
			shuffle(q.Deck)
		}
	default:
		return errors.New("leader has no active ability")
	}
	p.LeaderUsed = true
	leaderCard := Card{UID: fmt.Sprintf("leader-%d", index), Def: p.Leader - 1}
	r.emit("leader", index, &leaderCard, "", false, c)
	r.note(p.Name + " использовал(а) способность лидера")
	return nil
}

// A swap redraws a chosen card into the deck and deals a replacement without
// allowing the user to pick a particular card from the hidden deck order.
func (r *Room) redraw(index int, uid string, c Catalog) error {
	p := &r.Players[index]
	if p.Ready || p.Redraws <= 0 || len(p.Deck) == 0 {
		return errors.New("no redraw available")
	}
	card, ok := take(&p.Hand, uid)
	if !ok {
		return errors.New("card to redraw is not in hand")
	}
	last := len(p.Deck) - 1
	replacement := p.Deck[last]
	p.Deck = p.Deck[:last]
	p.Hand = append(p.Hand, replacement)
	p.Deck = append(p.Deck, card)
	shuffle(p.Deck)
	p.Redraws--
	return nil
}

// canTakeAction mirrors the original Player.canPlay: an empty hand may still
// act once with an active leader, but passive leaders never grant an extra turn.
func (r *Room) canTakeAction(index int, c Catalog) bool {
	if index < 0 || index >= len(r.Players) {
		return false
	}
	p := &r.Players[index]
	if len(p.Hand) > 0 {
		return true
	}
	if p.LeaderUsed || r.leadersNullified(c) {
		return false
	}
	for _, option := range LeaderOptions(c) {
		if option.ID == p.Leader {
			return !option.Passive
		}
	}
	return false
}

// The original ends a player's turn automatically when they have no cards and
// no usable leader, and startRound checks both players before starting a turn.
// Resolve forced passes after effects finish. A finite loop also handles empty
// subsequent rounds without recursion, including consecutive ties.
func (r *Room) settleForcedPasses(c Catalog) {
	if r.Status != "playing" || r.Phase == "mulligan" || r.PendingOwner != 0 || r.Initiative != 0 {
		return
	}
	for round := 0; round < 4 && r.Status == "playing"; round++ {
		for i := range r.Players {
			if !r.Players[i].Passed && !r.canTakeAction(i, c) {
				r.Players[i].Passed = true
				r.emit("pass", i, nil, "", false, c)
				r.note(r.Players[i].Name + " автоматически спасовал(а)")
			}
		}
		if r.Players[0].Passed && r.Players[1].Passed {
			r.finishRound(c)
			continue
		}
		if r.Players[r.Turn].Passed {
			r.Turn = 1 - r.Turn
		}
		return
	}
}

// ClockActive does not time the lobby, mulligan or first-player decision.
// A chained Medic target is part of the same timed turn.
func (r *Room) ClockActive() bool {
	return r.Status == "playing" && r.Phase == "turn" && r.Initiative == 0 && len(r.Players) == 2 && r.TimerSettings().Minutes > 0
}

// BeginTurn starts a fresh deadline only after a successfully committed move.
// Calling it from the locked Store prevents browser refreshes from adding time.
func (r *Room) BeginTurn(now time.Time) bool {
	if !r.ClockActive() {
		if r.TurnDeadline.IsZero() {
			return false
		}
		r.TurnDeadline = time.Time{}
		return true
	}
	deadline := now.Add(r.turnDuration())
	if deadline.After(r.ExpiresAt) {
		deadline = r.ExpiresAt
	}
	if deadline.Equal(r.TurnDeadline) {
		return false
	}
	r.TurnDeadline = deadline
	return true
}

// Tick is called under Store.mu BEFORE any room read or incoming action.
// Even a client sending a fresh expectedVersion cannot play past the deadline.
// It persists the forced pass and never trusts time supplied by the browser.
func (r *Room) Tick(now time.Time, c Catalog) bool {
	if !r.ClockActive() {
		if r.TurnDeadline.IsZero() {
			return false
		}
		r.TurnDeadline = time.Time{}
		return true
	}
	if r.TurnDeadline.IsZero() {
		r.BeginTurn(now) // backward-compatible persisted rooms
		r.Version++
		return true
	}
	if now.Before(r.TurnDeadline) {
		return false
	}
	if r.TimerSettings().Mode == TimerSoft {
		return false // Warning only: do not change the turn, version or pending choices.
	}
	seat := r.Turn
	// A Medic chain may still have unresolved required choices. Resolve each
	// from the server-held graveyard rather than allowing a stalled turn.
	if r.PendingOwner != 0 {
		seat = r.PendingOwner - 1
		for n := 0; n < 64; n++ {
			options := r.eligibleGrave(seat, c)
			if len(options) == 0 {
				break
			}
			best := options[0]
			for _, card := range options[1:] {
				if c[card.Def].Power() > c[best.Def].Power() {
					best = card
				}
			}
			result := r.reviveTarget(seat, best.UID, c)
			if result == nil || !c[result.Def].Has("medic") {
				break
			}
		}
		r.PendingOwner = 0
	}
	r.Players[seat].Passed = true
	r.emit("timeout", seat, nil, "", false, c)
	r.note(fmt.Sprintf("%s превысил(а) лимит %g мин и спасовал(а)", r.Players[seat].Name, r.TimerSettings().Minutes))
	if r.Players[0].Passed && r.Players[1].Passed {
		r.finishRound(c)
	} else if !r.Players[1-seat].Passed {
		r.Turn = 1 - seat
	}
	r.settleForcedPasses(c)
	r.Bots(c)
	r.BeginTurn(now)
	r.Version++
	return true
}

func (r *Room) Apply(index int, a Action, c Catalog) error {
	if r.Status != "playing" {
		return errors.New("match is not active")
	}
	if r.PendingOwner != 0 {
		if r.PendingOwner != index+1 || a.Type != "revive" {
			return errors.New("player must finish chained Medic effect")
		}
		if err := r.validateRevivePlacement(index, a.Target, a.TargetRow, c); err != nil {
			return err
		}
		r.PendingOwner = 0
		r.resolveMedic(index, a.Target, a.TargetRow, c)
		r.Version++
		if r.PendingOwner != 0 {
			return nil
		}
		if r.Players[0].Passed && r.Players[1].Passed {
			r.finishRound(c)
		} else if !r.Players[1-index].Passed {
			r.Turn = 1 - index
		}
		r.settleForcedPasses(c)
		r.Bots(c)
		return nil
	}
	if r.Phase == "mulligan" {
		p := &r.Players[index]
		switch a.Type {
		case "redraw":
			if err := r.redraw(index, a.UID, c); err != nil {
				return err
			}
			if p.Redraws == 0 {
				p.Ready = true
			}
		case "ready":
			if p.Ready {
				return errors.New("redraw already complete")
			}
			p.Ready = true
		default:
			return errors.New("finish selecting the opening hand")
		}
		if r.Players[0].Ready && r.Players[1].Ready {
			r.Phase = "turn"
			r.note("Игроки закончили замену карт")
			if r.Initiative == 0 {
				r.emit("round_start", r.Turn, nil, "", false, c)
			}
		}
		r.Version++
		if r.Phase == "turn" {
			r.Bots(c)
		}
		return nil
	}
	if r.Initiative != 0 {
		if index != r.Initiative-1 || a.Type != "initiative" {
			return errors.New("scoiatael player must choose initiative")
		}
		if a.Target != "self" && a.Target != "opponent" {
			return errors.New("choose self or opponent to begin")
		}
		r.Turn = index
		if a.Target == "opponent" {
			r.Turn = 1 - index
		}
		r.RoundStarter = r.Turn
		r.Initiative = 0
		r.emit("round_start", r.Turn, nil, "", false, c)
		r.Version++
		r.Bots(c)
		return nil
	}
	if a.Type == "initiative" {
		return errors.New("initiative has already been resolved")
	}
	if index != r.Turn || r.Players[index].Passed {
		return errors.New("not your turn")
	}
	switch a.Type {
	case "leader":
		if err := r.activateLeader(index, a, c); err != nil {
			return err
		}
	case "pass":
		r.Players[index].Passed = true
		r.emit("pass", index, nil, "", false, c)
		r.note(r.Players[index].Name + " спасовал(а)")
	case "play":
		if err := r.play(index, a, c); err != nil {
			return err
		}
	default:
		return ErrInvalid
	}
	if r.PendingOwner != 0 {
		r.Version++
		return nil
	}
	if r.Players[0].Passed && r.Players[1].Passed {
		r.finishRound(c)
	} else if !r.Players[1-index].Passed {
		r.Turn = 1 - index
	}
	r.Version++
	r.settleForcedPasses(c)
	r.Bots(c)
	return nil
}

// Clone via JSON: simulations must never mutate the real authoritative game state.
func (r *Room) simulation() *Room {
	base := *r
	base.Transitions = nil
	data, err := json.Marshal(&base)
	if err != nil {
		panic(err)
	}
	var clone Room
	if err = json.Unmarshal(data, &clone); err != nil {
		panic(err)
	}
	clone.simulating = true
	return &clone
}
func (r *Room) candidateActions(player int, c Catalog) []Action {
	p := r.Players[player]
	choices := []Action{}
	for _, card := range p.Hand {
		d := c[card.Def]
		if d.Has("decoy") {
			for _, row := range []string{"close", "ranged", "siege"} {
				for _, target := range p.Rows[row] {
					if isUnit(c[target.Def]) {
						choices = append(choices, Action{Type: "play", UID: card.UID, Target: target.UID})
					}
				}
			}
			continue
		}
		if d.Has("medic") && len(r.eligibleGrave(player, c)) > 0 && !r.randomRevival(c) {
			for _, target := range r.eligibleGrave(player, c) {
				row := d.Row
				if row == "agile" {
					row = "close"
				}
				targetRows := []string{""}
				if c[target.Def].Row == "agile" {
					targetRows = []string{"close", "ranged"}
				}
				for _, targetRow := range targetRows {
					choices = append(choices, Action{Type: "play", UID: card.UID, Row: row, Target: target.UID, TargetRow: targetRow})
				}
			}
			continue
		}
		targetRows := []string{d.Row}
		if d.Row == "agile" || (d.Deck == "special" && (d.Has("horn") || d.Has("mardroeme"))) {
			targetRows = []string{"close", "ranged", "siege"}
			if d.Row == "agile" {
				targetRows = []string{"close", "ranged"}
			}
		}
		for _, row := range targetRows {
			choices = append(choices, Action{Type: "play", UID: card.UID, Row: row})
		}
	}
	if !p.LeaderUsed {
		switch {
		case r.leaderHas(player, c, "emhyr_relentless"):
			for _, card := range r.eligibleGrave(1-player, c) {
				choices = append(choices, Action{Type: "leader", Target: card.UID})
			}
		case r.leaderHas(player, c, "eredin_bringer_of_death"):
			for _, card := range r.eligibleGrave(player, c) {
				choices = append(choices, Action{Type: "leader", Target: card.UID})
			}
		case r.leaderHas(player, c, "eredin_destroyer"):
			if len(p.Hand) >= 2 && len(p.Deck) > 0 {
				// Bot discards its two weakest units and draws the strongest available one.
				discard := append([]Card(nil), p.Hand...)
				for i := range discard {
					for j := i + 1; j < len(discard); j++ {
						if c[discard[i].Def].Power() > c[discard[j].Def].Power() {
							discard[i], discard[j] = discard[j], discard[i]
						}
					}
				}
				draw := p.Deck[0]
				for _, card := range p.Deck {
					if c[card.Def].Power() > c[draw.Def].Power() {
						draw = card
					}
				}
				choices = append(choices, Action{Type: "leader", Targets: []string{discard[0].UID, discard[1].UID}, Draw: draw.UID})
			}
		case r.leaderHas(player, c, "eredin_king"):
			for _, card := range p.Deck {
				if c[card.Def].Deck == "weather" {
					choices = append(choices, Action{Type: "leader", Target: card.UID})
				}
			}
		default:
			choices = append(choices, Action{Type: "leader"})
		}
	}
	return choices
}
func (r *Room) botChoices(c Catalog) []Action { return r.candidateActions(1, c) }

func (r *Room) botChoiceScore(a Action, c Catalog, difficulty BotDifficulty) (int, bool) {
	sim := r.simulation()
	beforeOwn, beforeOpp := sim.Score(1, c), sim.Score(0, c)
	var err error
	if a.Type == "leader" {
		err = sim.activateLeader(1, a, c)
	} else {
		err = sim.play(1, a, c)
	}
	if err != nil {
		return 0, false
	}
	ownDelta, oppDelta := sim.Score(1, c)-beforeOwn, sim.Score(0, c)-beforeOpp
	score := ownDelta - oppDelta
	if a.Type == "leader" {
		score += 2
	} else {
		d := c[cardByUID(r.Players[1].Hand, a.UID).Def]
		if d.Has("spy") {
			score += 17
		}
		if d.Has("medic") {
			score += 5
		}
		if d.Has("muster") {
			score += 3
		}
		if d.Has("hero") && !r.Players[0].Passed && r.Round == 1 {
			score -= 3
		}
		if d.Has("decoy") {
			score += 3
		}
		if d.Deck == "weather" && score <= 0 {
			score -= 8
		}
	}
	if r.Bot != nil {
		if r.Bot.Style == "aggressive" {
			score += ownDelta / 2
		}
		if r.Bot.Style == "economy" && a.Type == "play" {
			score -= c[cardByUID(r.Players[1].Hand, a.UID).Def].Power() / 3
			if c[cardByUID(r.Players[1].Hand, a.UID).Def].Has("spy") {
				score += 10
			}
		}
	}
	if difficulty == BotNormal {
		score += randomInt(12) - 5
	}
	return score, true
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
		p := r.Players[1]
		if r.PendingOwner == 2 {
			options := r.eligibleGrave(1, c)
			if len(options) > 0 {
				choice := options[0]
				for _, card := range options {
					if c[card.Def].Power() > c[choice.Def].Power() {
						choice = card
					}
				}
				_ = r.ApplyBot(Action{Type: "revive", Target: choice.UID}, c)
				continue
			}
			r.PendingOwner = 0
		}
		own, opp := r.Score(1, c), r.Score(0, c)
		if len(p.Hand) == 0 && (p.LeaderUsed || r.leadersNullified(c)) {
			_ = r.ApplyBot(Action{Type: "pass"}, c)
			continue
		}
		if r.Players[0].Passed && own > opp {
			_ = r.ApplyBot(Action{Type: "pass"}, c)
			continue
		}
		options := r.botChoices(c)
		type candidate struct {
			a     Action
			score int
		}
		candidates := []candidate{}
		for _, a := range options {
			score, valid := r.botChoiceScore(a, c, difficulty)
			if valid {
				candidates = append(candidates, candidate{a, score})
			}
		}
		if len(candidates) == 0 {
			_ = r.ApplyBot(Action{Type: "pass"}, c)
			continue
		}
		best := candidates[0]
		if difficulty == BotEasy {
			best = candidates[randomInt(len(candidates))]
			// Easy bot sometimes surrenders a contested round to preserve cards.
			if moves > 0 && len(p.Hand) < 5 && randomInt(8) == 0 {
				_ = r.ApplyBot(Action{Type: "pass"}, c)
				continue
			}
		} else {
			for _, candidate := range candidates {
				if candidate.score > best.score {
					best = candidate
				}
			}
			if (difficulty == BotHard || (r.Bot != nil && r.Bot.Style == "economy")) && r.Round < 3 && !r.Players[0].Passed && best.score < 0 && len(p.Hand) < 6 {
				_ = r.ApplyBot(Action{Type: "pass"}, c)
				continue
			}
		}
		if err := r.ApplyBot(best.a, c); err != nil {
			_ = r.ApplyBot(Action{Type: "pass"}, c)
		}
	}
}
func cardByUID(cards []Card, uid string) Card {
	for _, card := range cards {
		if card.UID == uid {
			return card
		}
	}
	return Card{}
}
func (r *Room) ApplyBot(a Action, c Catalog) error {
	if r.Mode != "bot" || r.Turn != 1 || r.Status != "playing" {
		return ErrInvalid
	}
	switch a.Type {
	case "revive":
		if r.PendingOwner != 2 {
			return ErrInvalid
		}
		if err := r.validateRevivePlacement(1, a.Target, a.TargetRow, c); err != nil {
			return err
		}
		r.PendingOwner = 0
		r.resolveMedic(1, a.Target, a.TargetRow, c)
	case "pass":
		r.Players[1].Passed = true
		r.emit("pass", 1, nil, "", false, c)
		r.note("Бот спасовал")
	case "play":
		if err := r.play(1, a, c); err != nil {
			return err
		}
	case "leader":
		if err := r.activateLeader(1, a, c); err != nil {
			return err
		}
	default:
		return ErrInvalid
	}
	if r.PendingOwner != 0 {
		r.Version++
		return nil
	}
	if r.Players[0].Passed && r.Players[1].Passed {
		r.finishRound(c)
	} else if !r.Players[0].Passed {
		r.Turn = 0
	}
	r.Version++
	r.settleForcedPasses(c)
	return nil
}

// Per-viewer projection never transmits an opponent's hand, draw order or identity token.
type CardView struct {
	Faction       string `json:"faction"`
	UID           string `json:"uid"`
	Def           int    `json:"def"`
	Name          string `json:"name"`
	NameRu        string `json:"nameRu"`
	Key           string `json:"key"`
	DescriptionEn string `json:"descriptionEn"`
	Description   string `json:"description"`
	Power         int    `json:"power"`
	Ability       string `json:"ability"`
	Row           string `json:"row"`
	Image         string `json:"image"`
	Special       bool   `json:"special"`
}
type PlayerView struct {
	Name              string                `json:"name"`
	Lives             int                   `json:"lives"`
	LeaderID          int                   `json:"leaderId"`
	LeaderRu          string                `json:"leaderRu"`
	Faction           string                `json:"faction"`
	Hand              []CardView            `json:"hand,omitempty"`
	Grave             []CardView            `json:"grave"`
	Special           map[string][]CardView `json:"special"`
	DeckChoices       []CardView            `json:"deckChoices,omitempty"`
	Peek              []CardView            `json:"peek,omitempty"`
	HandCount         int                   `json:"handCount"`
	DeckCount         int                   `json:"deckCount"`
	Score             int                   `json:"score"`
	Rows              map[string][]CardView `json:"rows"`
	Passed            bool                  `json:"passed"`
	Wins              int                   `json:"wins"`
	Leader            string                `json:"leader"`
	LeaderDescription string                `json:"leaderDescription"`
	LeaderPassive     bool                  `json:"leaderPassive"`
	LeaderUsed        bool                  `json:"leaderUsed"`
	Ready             bool                  `json:"ready"`
	Redraws           int                   `json:"redraws"`
}
type View struct {
	Timer        TurnTimer     `json:"timer"`
	Code         string        `json:"code"`
	EventSeq     int           `json:"eventSeq"`
	Transitions  []MatchEvent  `json:"transitions,omitempty"`
	Mode         string        `json:"mode"`
	Status       string        `json:"status"`
	Phase        string        `json:"phase,omitempty"`
	Version      int           `json:"version"`
	ExpiresAt    time.Time     `json:"expiresAt"`
	TurnDeadline time.Time     `json:"turnDeadline,omitempty"`
	ServerTime   time.Time     `json:"serverTime"`
	Seat         int           `json:"seat"`
	Turn         int           `json:"turn"`
	Initiative   int           `json:"initiative"`
	PendingOwner int           `json:"pendingOwner,omitempty"`
	Round        int           `json:"round"`
	RoundHistory []RoundResult `json:"roundHistory,omitempty"`
	Winner       int           `json:"winner"`
	Weather      []string      `json:"weather"`
	WeatherCards []CardView    `json:"weatherCards,omitempty"`
	Players      []PlayerView  `json:"players"`
	Events       []string      `json:"events"`
	Bot          *BotPublic    `json:"bot,omitempty"`
}
type BotPublic struct {
	Style      string        `json:"style"`
	Difficulty BotDifficulty `json:"difficulty"`
	DeckMode   BotDeckMode   `json:"deckMode"`
	Faction    string        `json:"faction"`
}

func cardView(card Card, c Catalog) CardView {
	d := c[card.Def]
	return CardView{Faction: d.Deck, UID: card.UID, Def: card.Def, Key: d.StableKey(), NameRu: d.RussianName(), Description: d.Description(), DescriptionEn: d.DescriptionEn(), Name: d.Name, Power: d.Power() + card.Boost, Ability: d.Ability, Row: d.Row, Image: d.Artwork(), Special: d.Deck == "weather" || d.Deck == "special"}
}
func (r *Room) projectState(seat int, c Catalog) View {
	v := View{Timer: r.TimerSettings(), Code: r.Code, Mode: r.Mode, Status: r.Status, Phase: r.Phase, Version: r.Version, ExpiresAt: r.ExpiresAt, TurnDeadline: r.TurnDeadline, ServerTime: time.Now().UTC(), Seat: seat, Turn: r.Turn, Initiative: r.Initiative, PendingOwner: r.PendingOwner, Round: r.Round, RoundHistory: append([]RoundResult(nil), r.RoundHistory...), Winner: r.Winner, Weather: append([]string{}, r.Weather...), Events: append([]string{}, r.Events...), Players: []PlayerView{}}
	for _, card := range r.WeatherCards {
		v.WeatherCards = append(v.WeatherCards, cardView(card.Card, c))
	}
	if r.Bot != nil {
		v.Bot = &BotPublic{Style: r.Bot.Style, Difficulty: r.Bot.Difficulty, DeckMode: r.Bot.DeckMode, Faction: r.Bot.Faction}
	}
	for i, p := range r.Players {
		pv := PlayerView{Lives: 2, LeaderID: p.Leader, Name: p.Name, Faction: p.Faction, HandCount: len(p.Hand), DeckCount: len(p.Deck), Passed: p.Passed, Wins: p.Wins, Score: r.Score(i, c), Rows: map[string][]CardView{"close": {}, "ranged": {}, "siege": {}}, Special: map[string][]CardView{"close": {}, "ranged": {}, "siege": {}}, Grave: []CardView{}, LeaderUsed: p.LeaderUsed, Ready: p.Ready, Redraws: p.Redraws}
		if p.Leader > 0 && p.Leader <= len(c) {
			d := c[p.Leader-1]
			pv.Leader = d.Name
			pv.LeaderRu = d.RussianName()
			for _, ability := range strings.Fields(d.Ability) {
				if description, ok := supportedLeaders[ability]; ok {
					pv.LeaderDescription = description
					pv.LeaderPassive = ability == "emhyr_whiteflame" || ability == "eredin_treacherous" || ability == "francesca_daisy" || ability == "king_bran" || ability == "emhyr_invader"
					break
				}
			}
		}
		for _, card := range p.Grave {
			pv.Grave = append(pv.Grave, cardView(card, c))
		}
		for _, row := range []string{"close", "ranged", "siege"} {
			for _, card := range p.Special[row] {
				pv.Special[row] = append(pv.Special[row], cardView(card, c))
			}
			// The original leaderHorn creates a temporary Commander's Horn card in
			// the row's special slot. It affects the row, but is never part of the
			// player's physical deck or graveyard. Recreate its artwork in the
			// public projection without inventing a server-side physical card.
			if p.Horn[row] && len(p.Special[row]) == 0 {
				if hornID := c.Find("Commander's Horn"); hornID >= 0 {
					pv.Special[row] = append(pv.Special[row], cardView(Card{UID: fmt.Sprintf("leader-horn-%d-%s", i, row), Def: hornID}, c))
				}
			}
			strengths := r.unitPowers(i, row, c)
			for _, card := range p.Rows[row] {
				viewed := cardView(card, c)
				viewed.Power = strengths[card.UID]
				pv.Rows[row] = append(pv.Rows[row], viewed)
			}
		}
		if i == seat {
			pv.DeckChoices = make([]CardView, 0, len(p.Deck))
			for _, card := range p.Deck {
				pv.DeckChoices = append(pv.DeckChoices, cardView(card, c))
			}
			// Never leak the shuffled draw order. The original player knows their
			// deck composition, but not which card will be drawn next.
			sort.Slice(pv.DeckChoices, func(a, b int) bool {
				if pv.DeckChoices[a].Def != pv.DeckChoices[b].Def {
					return pv.DeckChoices[a].Def < pv.DeckChoices[b].Def
				}
				return pv.DeckChoices[a].UID < pv.DeckChoices[b].UID
			})
			for _, card := range p.Peek {
				pv.Peek = append(pv.Peek, cardView(card, c))
			}
			pv.Hand = []CardView{}
			for _, card := range p.Hand {
				pv.Hand = append(pv.Hand, cardView(card, c))
			}
		}
		for _, round := range r.RoundHistory {
			if round.Winner != i {
				pv.Lives--
			}
		}
		if pv.Lives < 0 {
			pv.Lives = 0
		}
		v.Players = append(v.Players, pv)
	}
	return v
}
func (r *Room) IndexFor(id string) int {
	for i, p := range r.Players {
		if p.ID == id {
			return i
		}
	}
	return -1
}
