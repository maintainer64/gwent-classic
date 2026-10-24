package game

import "errors"

// A reserved invitation may accept the guest before the host finalizes a deck.
// Only the host can commit the final setup; cards are dealt once both are ready.
func (r *Room) PrepareLobby(seat int, name, faction string, leader int, deck []DeckEntry, timer *TurnTimer, c Catalog) error {
	if seat != 0 {
		return errors.New("not a player allowed to configure the lobby")
	}
	if !r.Lobby || r.Mode != "pvp" || r.Status != "waiting" || r.LobbyReady[0] || len(r.Players) == 0 {
		return errors.New("room is not accepting setup changes")
	}
	settings, err := NormalizeTimer(timer)
	if err != nil {
		return err
	}
	player, err := addPlayer(r.Players[0].ID, name, faction, c, leader)
	if err != nil {
		return err
	}
	if err := assignCustomDeck(&player, c, faction, deck); err != nil {
		return err
	}
	r.Players[0] = player
	r.Timer = &settings
	r.LobbyReady[0] = true
	r.Version++
	if len(r.Players) == 2 && r.LobbyReady[1] {
		r.start(c)
	}
	return nil
}
