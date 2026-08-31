// =====================================================
// MICROSEP — Web Serial Communication Layer
// =====================================================
// Handles USB Serial connection to Arduino using the
// Web Serial API (Chrome/Edge only).
//
// Usage:
//   const serial = new MicrosepSerial();
//   await serial.connect();
//   serial.send("CMD:START");
//   serial.onData = (json) => { ... };
//   serial.onConnect = () => { ... };
//   serial.onDisconnect = () => { ... };
// =====================================================

class MicrosepSerial {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.readableStreamClosed = null;
    this.writableStreamClosed = null;
    this.connected = false;
    this.buffer = '';

    // Callbacks
    this.onData = null;         // Called with parsed JSON object
    this.onRawLine = null;      // Called with raw line string
    this.onConnect = null;
    this.onDisconnect = null;
    this.onError = null;
  }

  // Check if Web Serial API is available
  static isSupported() {
    return 'serial' in navigator;
  }

  // Connect to Arduino
  async connect() {
    if (!MicrosepSerial.isSupported()) {
      throw new Error('Web Serial API not supported. Use Chrome or Edge.');
    }

    try {
      // Request port from user (browser shows picker)
      this.port = await navigator.serial.requestPort();

      // Open with Arduino's baud rate
      await this.port.open({ baudRate: 9600 });

      this.connected = true;

      // Set up writer
      const textEncoder = new TextEncoderStream();
      this.writableStreamClosed = textEncoder.readable.pipeTo(this.port.writable);
      this.writer = textEncoder.writable.getWriter();

      // Start reading
      this._startReading();

      if (this.onConnect) this.onConnect();

      // Listen for disconnect
      this.port.addEventListener('disconnect', () => {
        this._handleDisconnect();
      });

      return true;
    } catch (err) {
      if (err.name === 'NotFoundError') {
        // User cancelled the port picker
        return false;
      }
      if (this.onError) this.onError(err);
      throw err;
    }
  }

  // Disconnect from Arduino
  async disconnect() {
    try {
      if (this.reader) {
        await this.reader.cancel();
        await this.readableStreamClosed.catch(() => {});
      }
      if (this.writer) {
        await this.writer.close();
        await this.writableStreamClosed.catch(() => {});
      }
      if (this.port) {
        await this.port.close();
      }
    } catch (err) {
      console.warn('Disconnect error:', err);
    }
    this._handleDisconnect();
  }

  // Send a command to Arduino (adds newline)
  async send(command) {
    if (!this.connected || !this.writer) {
      console.warn('Not connected, cannot send:', command);
      return false;
    }
    try {
      await this.writer.write(command + '\n');
      console.log('TX:', command);
      return true;
    } catch (err) {
      console.error('Send error:', err);
      if (this.onError) this.onError(err);
      return false;
    }
  }

  // Internal: start reading from serial port
  async _startReading() {
    const textDecoder = new TextDecoderStream();
    this.readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable);
    this.reader = textDecoder.readable.getReader();

    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) this._processChunk(value);
      }
    } catch (err) {
      if (err.name !== 'TypeError') { // Ignore close errors
        console.error('Read error:', err);
        if (this.onError) this.onError(err);
      }
    }
  }

  // Internal: process incoming text chunks into lines
  _processChunk(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');

    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (this.onRawLine) this.onRawLine(trimmed);

      // Try to parse as JSON
      if (trimmed.startsWith('{')) {
        try {
          const json = JSON.parse(trimmed);
          if (this.onData) this.onData(json);
        } catch (e) {
          console.warn('Invalid JSON:', trimmed);
        }
      }
    }
  }

  // Internal: handle disconnect cleanup
  _handleDisconnect() {
    this.connected = false;
    this.port = null;
    this.reader = null;
    this.writer = null;
    if (this.onDisconnect) this.onDisconnect();
  }
}

// Make globally available
window.MicrosepSerial = MicrosepSerial;
