package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/maintainer64/gwent-classic/internal/game"
)

var roomCode = regexp.MustCompile(`^[A-Z2-9]{12}$`)
var ErrExpired = errors.New("room expired")
var ErrMissing = errors.New("room not found")

// Store uses one atomic file per room. Reads and writes are serialized within the process;
// it is intended for ONE Go server instance and a persistent Docker volume.
type Store struct {
	mu      sync.Mutex
	dir     string
	now     func() time.Time
	catalog game.Catalog
}

func NewStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	return &Store{dir: dir, now: time.Now}, nil
}
func (s *Store) SetClock(now func() time.Time) { s.mu.Lock(); defer s.mu.Unlock(); s.now = now }
func (s *Store) SetCatalog(c game.Catalog)     { s.mu.Lock(); defer s.mu.Unlock(); s.catalog = c }
func (s *Store) path(code string) (string, error) {
	if !roomCode.MatchString(code) {
		return "", ErrMissing
	}
	return filepath.Join(s.dir, code+".json"), nil
}
func (s *Store) read(code string) (*game.Room, error) {
	path, err := s.path(code)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, ErrMissing
	}
	if err != nil {
		return nil, err
	}
	var r game.Room
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, fmt.Errorf("invalid persisted room %s: %w", code, err)
	}
	if !s.now().Before(r.ExpiresAt) {
		_ = os.Remove(path)
		return nil, ErrExpired
	}
	if s.catalog != nil && r.Tick(s.now(), s.catalog) {
		if err := s.write(&r); err != nil {
			return nil, err
		}
	}
	return &r, nil
}
func (s *Store) write(r *game.Room) error {
	path, err := s.path(r.Code)
	if err != nil {
		return err
	}
	data, err := json.Marshal(r)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(s.dir, ".write-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err := f.Chmod(0600); err != nil {
		f.Close()
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}
func (s *Store) Create(r *game.Room) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.path(r.Code); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(s.dir, r.Code+".json")); err == nil {
		return errors.New("room already exists")
	} else if !os.IsNotExist(err) {
		return err
	}
	return s.write(r)
}
func (s *Store) Load(code string) (*game.Room, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read(code)
}
func (s *Store) Change(code string, expected int, change func(*game.Room) error) (*game.Room, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, err := s.read(code)
	if err != nil {
		return nil, err
	}
	if r.Version != expected {
		return nil, errors.New("stale room version")
	}
	if err := change(r); err != nil {
		return nil, err
	}
	// A chained Medic is still part of the same hard-timed move. Preserve
	// the original deadline across all mandatory revival selections.
	if s.catalog != nil && r.PendingOwner == 0 {
		r.BeginTurn(s.now())
	}
	if !s.now().Before(r.ExpiresAt) {
		_ = os.Remove(filepath.Join(s.dir, code+".json"))
		return nil, ErrExpired
	}
	// Starting a match and joining must also increment the version.
	if r.Version == expected {
		r.Version++
	}
	if err := s.write(r); err != nil {
		return nil, err
	}
	return r, nil
}
func (s *Store) Clean() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return 0
	}
	n := 0
	for _, item := range entries {
		if item.IsDir() || !roomCode.MatchString(item.Name()[:max(0, len(item.Name())-len(".json"))]) || filepath.Ext(item.Name()) != ".json" {
			continue
		}
		code := item.Name()[:len(item.Name())-len(".json")]
		_, err := s.read(code)
		if errors.Is(err, ErrExpired) {
			n++
		}
	}
	return n
}

// RoomSummary deliberately contains no deck, hand, secrets or opponent identifiers.
type RoomSummary struct {
	Code      string    `json:"code"`
	Mode      string    `json:"mode"`
	Status    string    `json:"status"`
	Name      string    `json:"name"`
	Players   int       `json:"players"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// List returns only rooms joined from the present anonymous browser session.
func (s *Store) List(playerID string) ([]RoomSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	rooms := []RoomSummary{}
	for _, item := range entries {
		if item.IsDir() || !strings.HasSuffix(item.Name(), ".json") {
			continue
		}
		code := strings.TrimSuffix(item.Name(), ".json")
		if !roomCode.MatchString(code) {
			continue
		}
		room, err := s.read(code)
		if errors.Is(err, ErrExpired) || errors.Is(err, ErrMissing) {
			continue
		}
		if err != nil {
			return nil, err
		}
		seat := room.IndexFor(playerID)
		if seat < 0 {
			continue
		}
		rooms = append(rooms, RoomSummary{Code: room.Code, Mode: room.Mode, Status: room.Status, Name: room.Players[seat].Name, Players: len(room.Players), ExpiresAt: room.ExpiresAt})
		if len(rooms) >= 30 {
			break
		}
	}
	return rooms, nil
}
