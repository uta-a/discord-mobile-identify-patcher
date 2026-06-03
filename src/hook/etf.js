const ETF_VERSION = 131;

function decodeEtf(input) {
  const bytes = toUint8Array(input);
  const reader = new EtfReader(bytes);
  const version = reader.u8();
  if (version !== ETF_VERSION) {
    throw new Error(`Unsupported ETF version: ${version}`);
  }

  return reader.term();
}

function encodeEtf(value) {
  const writer = new EtfWriter();
  writer.u8(ETF_VERSION);
  writer.term(value);
  return writer.toUint8Array();
}

function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }

  throw new TypeError("Expected ArrayBuffer or typed array");
}

class EtfReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
  }

  u8() {
    return this.bytes[this.offset++];
  }

  u16() {
    const value = (this.bytes[this.offset] << 8) | this.bytes[this.offset + 1];
    this.offset += 2;
    return value;
  }

  u32() {
    const value =
      this.bytes[this.offset] * 0x1000000 +
      ((this.bytes[this.offset + 1] << 16) | (this.bytes[this.offset + 2] << 8) | this.bytes[this.offset + 3]);
    this.offset += 4;
    return value >>> 0;
  }

  i32() {
    const value = this.u32();
    return value > 0x7fffffff ? value - 0x100000000 : value;
  }

  bytesOf(length) {
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  term() {
    const tag = this.u8();

    switch (tag) {
      case 97:
        return this.u8();
      case 98:
        return this.i32();
      case 100:
        return this.text(this.u16());
      case 107:
        return Array.from(this.bytesOf(this.u16()));
      case 106:
        return [];
      case 108:
        return this.list(this.u32());
      case 109:
        return this.text(this.u32());
      case 110:
        return this.smallBig();
      case 116:
        return this.map(this.u32());
      case 118:
        return this.text(this.u16());
      case 119:
        return this.text(this.u8());
      default:
        throw new Error(`Unsupported ETF tag: ${tag}`);
    }
  }

  list(length) {
    const result = [];
    for (let index = 0; index < length; index += 1) {
      result.push(this.term());
    }

    const tailTag = this.u8();
    if (tailTag !== 106) {
      throw new Error(`Unsupported improper ETF list tail tag: ${tailTag}`);
    }

    return result;
  }

  map(length) {
    const result = {};
    for (let index = 0; index < length; index += 1) {
      result[this.term()] = this.term();
    }

    return result;
  }

  smallBig() {
    const length = this.u8();
    const sign = this.u8();
    let value = 0n;

    for (let index = 0; index < length; index += 1) {
      value += BigInt(this.u8()) << BigInt(index * 8);
    }

    if (sign === 1) value = -value;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value;
  }

  text(length) {
    return new TextDecoder().decode(this.bytesOf(length));
  }
}

class EtfWriter {
  constructor() {
    this.bytes = [];
  }

  u8(value) {
    this.bytes.push(value & 0xff);
  }

  u16(value) {
    this.bytes.push((value >>> 8) & 0xff, value & 0xff);
  }

  u32(value) {
    this.bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  }

  raw(values) {
    for (const value of values) {
      this.u8(value);
    }
  }

  term(value) {
    if (Number.isInteger(value) && value >= 0 && value <= 255) {
      this.u8(97);
      this.u8(value);
      return;
    }

    if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) {
      this.u8(98);
      this.u32(value >>> 0);
      return;
    }

    if (typeof value === "bigint") {
      this.big(value);
      return;
    }

    if (typeof value === "string") {
      this.binary(value);
      return;
    }

    if (Array.isArray(value)) {
      this.list(value);
      return;
    }

    if (value && typeof value === "object") {
      this.map(value);
      return;
    }

    throw new Error(`Cannot encode ETF value: ${String(value)}`);
  }

  binary(value) {
    const bytes = new TextEncoder().encode(value);
    this.u8(109);
    this.u32(bytes.length);
    this.raw(bytes);
  }

  list(values) {
    if (values.length === 0) {
      this.u8(106);
      return;
    }

    this.u8(108);
    this.u32(values.length);
    for (const value of values) {
      this.term(value);
    }
    this.u8(106);
  }

  map(value) {
    const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
    this.u8(116);
    this.u32(entries.length);
    for (const [key, entryValue] of entries) {
      this.term(key);
      this.term(entryValue);
    }
  }

  big(value) {
    const negative = value < 0n;
    let rest = negative ? -value : value;
    const bytes = [];

    while (rest > 0n) {
      bytes.push(Number(rest & 0xffn));
      rest >>= 8n;
    }

    this.u8(110);
    this.u8(bytes.length);
    this.u8(negative ? 1 : 0);
    this.raw(bytes);
  }

  toUint8Array() {
    return new Uint8Array(this.bytes);
  }
}

module.exports = {
  decodeEtf,
  encodeEtf
};
