// Talks to the Express backend (REST) and Socket.IO (live seat updates).
// app.js only uses window.API and window.Realtime, so the UI code
// doesn't care how data arrives.

window.API = {
  async request(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Something went wrong');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },

  // Release holds when the tab closes (fetch may not finish in time)
  releaseOnExit(showId, userId) {
    const blob = new Blob([JSON.stringify({ userId })], { type: 'application/json' });
    navigator.sendBeacon(`/api/shows/${showId}/release`, blob);
  }
};

window.Realtime = {
  socket: null,
  showId: null,
  onSeats: null,
  onViewers: null,

  connect(showId, onSeats, onViewers) {
    this.showId = showId;
    this.onSeats = onSeats;
    this.onViewers = onViewers;
    if (!this.socket) {
      this.socket = io();
      this.socket.on('seats', msg => {
        if (msg.showId === this.showId && this.onSeats) this.onSeats(msg.seats);
      });
      this.socket.on('viewers', msg => {
        if (msg.showId === this.showId && this.onViewers) this.onViewers(msg.count);
      });
      // Re-join after a reconnect (e.g. Wi-Fi drops)
      this.socket.on('connect', () => {
        if (this.showId) this.socket.emit('join', this.showId);
      });
      this.socket.on('disconnect', () => window.dispatchEvent(new Event('realtime-offline')));
      this.socket.on('connect', () => window.dispatchEvent(new Event('realtime-online')));
    }
    if (this.socket.connected) this.socket.emit('join', showId);
  },

  disconnect() {
    this.showId = null;
    this.onSeats = null;
    this.onViewers = null;
    if (this.socket) this.socket.emit('leave');
  }
};
