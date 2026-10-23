package server

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/maintainer64/gwent-classic/internal/game"
)

// Minimal RFC 6455 WebSocket server for the two-seat Gwent room protocol.
// Written by hand to keep the module free of third-party dependencies.
// Supported subset: text frames only, no fragmentation (browsers never
// fragment small messages), server pings with browser auto-pongs, and a
// "sync" text message from the client to request a fresh snapshot.
const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
const wsMaxFrame = 64 << 10 // Incoming commands only; outgoing snapshots may be larger.
const wsPingEvery = 25 * time.Second
const wsReadTimeout = 75 * time.Second
const wsWriteTimeout = 5 * time.Second

type wsConn struct {
	hub       *Hub
	code      string
	user      string
	seat      int
	conn      net.Conn
	br        *bufio.Reader
	bw        *bufio.Writer
	writeMu   sync.Mutex
	done      chan struct{}
	closeOnce sync.Once
	updates   chan *game.Room
	queueMu   sync.Mutex
}

// Hub tracks live WebSocket connections per room and pushes authoritative
// projections after every state change and periodically for turn timeouts.
type Hub struct {
	mu       sync.Mutex
	conns    map[string]map[*wsConn]struct{}
	store    *Store
	catalog  game.Catalog
	lastPush map[string]int
}

func NewHub(store *Store, catalog game.Catalog) *Hub {
	h := &Hub{conns: map[string]map[*wsConn]struct{}{}, store: store, catalog: catalog, lastPush: map[string]int{}}
	go h.tickLoop()
	return h
}

func (h *Hub) add(c *wsConn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	set := h.conns[c.code]
	if set == nil {
		set = map[*wsConn]struct{}{}
		h.conns[c.code] = set
	}
	set[c] = struct{}{}
}

func (h *Hub) remove(c *wsConn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if set := h.conns[c.code]; set != nil {
		delete(set, c)
		if len(set) == 0 {
			delete(h.conns, c.code)
			delete(h.lastPush, c.code)
		}
	}
}

func (h *Hub) liveCodes() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	codes := make([]string, 0, len(h.conns))
	for code := range h.conns {
		codes = append(codes, code)
	}
	return codes
}

// Broadcast pushes a fresh projection to every member of the room. Each
// connection receives the view for its own seat, so hidden hands stay hidden.
func (h *Hub) Broadcast(code string, room *game.Room) {
	h.mu.Lock()
	set := h.conns[code]
	targets := make([]*wsConn, 0, len(set))
	for c := range set {
		targets = append(targets, c)
	}
	if room != nil {
		h.lastPush[code] = room.Version
	}
	h.mu.Unlock()
	for _, c := range targets {
		c.send(room)
	}
}

func (h *Hub) closeRoom(code string) {
	h.mu.Lock()
	set := h.conns[code]
	targets := make([]*wsConn, 0, len(set))
	for c := range set {
		targets = append(targets, c)
	}
	h.mu.Unlock()
	for _, c := range targets {
		c.close()
	}
}

// tickLoop keeps rooms with live spectators advancing: Store.read applies
// turn timeouts lazily on access, so connected clients trigger the same
// authoritative transition the turn timer would otherwise need, and everyone gets the push.
func (h *Hub) tickLoop() {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for range t.C {
		for _, code := range h.liveCodes() {
			room, err := h.store.Load(code)
			if err != nil {
				h.closeRoom(code)
				continue
			}
			h.mu.Lock()
			changed := h.lastPush[code] != room.Version
			h.mu.Unlock()
			if changed {
				h.Broadcast(code, room)
			}
		}
	}
}

func (c *wsConn) send(room *game.Room) {
	if room == nil {
		return
	}
	c.queueMu.Lock()
	defer c.queueMu.Unlock()
	select {
	case <-c.done:
		return
	default:
	}
	select {
	case previous := <-c.updates:
		if previous.Version > room.Version {
			room = previous
		}
	default:
	}
	select {
	case c.updates <- room:
	case <-c.done:
	}
}
func (c *wsConn) writeLoop() {
	lastVersion := -1
	for {
		select {
		case <-c.done:
			return
		case room := <-c.updates:
			if room.Version < lastVersion {
				continue
			}
			data, err := json.Marshal(room.Project(c.seat, c.hub.catalog))
			if err != nil {
				continue
			}
			c.writeMu.Lock()
			_ = c.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
			err = writeFrame(c.bw, 0x1, data)
			c.writeMu.Unlock()
			if err != nil {
				c.close()
				return
			}
			lastVersion = room.Version
		}
	}
}

func (c *wsConn) control(opcode byte, payload []byte) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
	if err := writeFrame(c.bw, opcode, payload); err != nil {
		c.close()
	}
}

func (c *wsConn) close() {
	c.closeOnce.Do(func() {
		close(c.done)
		_ = c.conn.Close()
		c.hub.remove(c)
	})
}

// readLoop handles client frames and keepalive pings until the socket dies.
func (c *wsConn) readLoop() {
	defer c.close()
	done := make(chan struct{})
	defer close(done)
	go func() {
		t := time.NewTicker(wsPingEvery)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-c.done:
				return
			case <-t.C:
				c.control(0x9, nil)
			}
		}
	}()
	for {
		_ = c.conn.SetReadDeadline(time.Now().Add(wsReadTimeout))
		opcode, payload, err := readFrame(c.br)
		if err != nil {
			return
		}
		switch opcode {
		case 0x8: // close
			c.control(0x8, payload)
			return
		case 0x9: // ping
			c.control(0xA, payload)
		case 0xA: // pong
			// Read deadline above was refreshed; nothing else to do.
		case 0x1: // text
			if string(payload) == "sync" {
				room, err := c.hub.store.Load(c.code)
				if err != nil {
					return
				}
				c.hub.Broadcast(c.code, room)
			}
		}
	}
}

// wsHandshakeOK validates the upgrade request before hijacking the connection.
func wsHandshakeOK(r *http.Request) bool {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	if !strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade") {
		return false
	}
	return r.Header.Get("Sec-WebSocket-Version") == "13" && len(r.Header.Get("Sec-WebSocket-Key")) >= 16
}

func wsAcceptKey(key string) string {
	sum := sha1.Sum([]byte(key + wsGUID))
	return base64.StdEncoding.EncodeToString(sum[:])
}

// serveWS upgrades an authenticated room member and starts pushing updates.
func (a *API) serveWS(w http.ResponseWriter, r *http.Request, code, user string) {
	hj, ok := w.(http.Hijacker)
	if !ok {
		fail(w, 500, "WebSocket unsupported")
		return
	}
	room, err := a.Store.Load(code)
	if err != nil {
		storeError(w, err)
		return
	}
	seat := room.IndexFor(user)
	if seat < 0 {
		fail(w, 403, "Join to see this room")
		return
	}
	conn, bufrw, err := hj.Hijack()
	if err != nil {
		fail(w, 500, "Cannot upgrade connection")
		return
	}
	accept := wsAcceptKey(r.Header.Get("Sec-WebSocket-Key"))
	head := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
	if _, err := bufrw.WriteString(head); err != nil {
		_ = conn.Close()
		return
	}
	if err := bufrw.Flush(); err != nil {
		_ = conn.Close()
		return
	}
	c := &wsConn{hub: a.Hub, code: code, user: user, seat: seat, conn: conn, br: bufrw.Reader, bw: bufrw.Writer, done: make(chan struct{}), updates: make(chan *game.Room, 1)}
	a.Hub.add(c)
	go c.writeLoop()
	c.send(room)
	go c.readLoop()
}

// readFrame parses one masked client frame (RFC 6455 §5.1).
func readFrame(br *bufio.Reader) (byte, []byte, error) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(br, header); err != nil {
		return 0, nil, err
	}
	if header[0]&0x80 == 0 {
		return 0, nil, errors.New("fragmented frames are not supported")
	}
	opcode := header[0] & 0x0f
	masked := header[1]&0x80 != 0
	if !masked {
		return 0, nil, errors.New("client frames must be masked")
	}
	length := int64(header[1] & 0x7f)
	switch length {
	case 126:
		var ext [2]byte
		if _, err := io.ReadFull(br, ext[:]); err != nil {
			return 0, nil, err
		}
		length = int64(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		if _, err := io.ReadFull(br, ext[:]); err != nil {
			return 0, nil, err
		}
		length = int64(binary.BigEndian.Uint64(ext[:]))
		if length < 0 {
			return 0, nil, errors.New("invalid frame length")
		}
	}
	if length > wsMaxFrame {
		return 0, nil, fmt.Errorf("frame too large: %d", length)
	}
	var mask [4]byte
	if _, err := io.ReadFull(br, mask[:]); err != nil {
		return 0, nil, err
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(br, payload); err != nil {
		return 0, nil, err
	}
	for i := range payload {
		payload[i] ^= mask[i%4]
	}
	return opcode, payload, nil
}

// writeFrame sends one unmasked server frame (RFC 6455 §5.1).
func writeFrame(bw *bufio.Writer, opcode byte, payload []byte) error {
	if err := bw.WriteByte(0x80 | opcode); err != nil {
		return err
	}
	switch n := len(payload); {
	case n < 126:
		if err := bw.WriteByte(byte(n)); err != nil {
			return err
		}
	case n <= 0xffff:
		if err := bw.WriteByte(126); err != nil {
			return err
		}
		var ext [2]byte
		binary.BigEndian.PutUint16(ext[:], uint16(n))
		if _, err := bw.Write(ext[:]); err != nil {
			return err
		}
	default:
		if err := bw.WriteByte(127); err != nil {
			return err
		}
		var ext [8]byte
		binary.BigEndian.PutUint64(ext[:], uint64(n))
		if _, err := bw.Write(ext[:]); err != nil {
			return err
		}
	}
	if _, err := bw.Write(payload); err != nil {
		return err
	}
	return bw.Flush()
}
