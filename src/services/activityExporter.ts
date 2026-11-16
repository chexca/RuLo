import type { RecordedSample } from '../types/workout';

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}

/**
 * Generates a standard Garmin TrainingCenterDatabase v2 TCX XML string.
 * Fully compatible with Strava, Garmin Connect, TrainingPeaks, and Intervals.icu.
 */
export function generateTcx(workoutName: string, samples: RecordedSample[]): string {
  const safeSamples = samples ?? [];
  const startMs = safeSamples[0]?.timestampMs ?? Date.now();
  const startTimeIso = new Date(startMs).toISOString();

  const lastSample = safeSamples[safeSamples.length - 1];
  const totalTimeSeconds = lastSample ? Math.max(0, lastSample.elapsedSec) : 0;
  const distanceMeters = lastSample ? Math.max(0, lastSample.distanceMeters) : 0;

  let maxSpeedMps = 0;
  let totalWatts = 0;
  let hrSum = 0;
  let hrCount = 0;
  let maxHr = 0;

  for (const s of safeSamples) {
    const speedMps = (s.speedKmh ?? 0) / 3.6;
    if (speedMps > maxSpeedMps) {
      maxSpeedMps = speedMps;
    }
    totalWatts += s.powerWatts ?? 0;
    if (s.heartRateBpm && s.heartRateBpm > 0) {
      hrSum += s.heartRateBpm;
      hrCount++;
      if (s.heartRateBpm > maxHr) {
        maxHr = s.heartRateBpm;
      }
    }
  }

  // Energy expenditure in kcal (~1 kJ = 1 kcal in cycling accounting for human efficiency)
  const avgWatts = safeSamples.length > 0 ? totalWatts / safeSamples.length : 0;
  const calories = Math.round((avgWatts * totalTimeSeconds) / 1000);

  const avgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : 0;

  const trackpointsXml = safeSamples
    .map((s) => {
      const timeIso = new Date(s.timestampMs).toISOString();
      const speedMps = ((s.speedKmh ?? 0) / 3.6).toFixed(2);
      const watts = Math.max(0, Math.round(s.powerWatts ?? 0));
      const dist = (s.distanceMeters ?? 0).toFixed(1);
      const cad = Math.max(0, Math.round(s.cadenceRpm ?? 0));

      const hrBlock =
        s.heartRateBpm && s.heartRateBpm > 0
          ? `          <HeartRateBpm>
            <Value>${Math.round(s.heartRateBpm)}</Value>
          </HeartRateBpm>`
          : '';

      return `        <Trackpoint>
          <Time>${timeIso}</Time>
          <DistanceMeters>${dist}</DistanceMeters>
          <Cadence>${cad}</Cadence>
${hrBlock ? hrBlock + '\n' : ''}          <Extensions>
            <ns3:TPX>
              <ns3:Speed>${speedMps}</ns3:Speed>
              <ns3:Watts>${watts}</ns3:Watts>
            </ns3:TPX>
          </Extensions>
        </Trackpoint>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd http://www.garmin.com/xmlschemas/ActivityExtension/v2 http://www.garmin.com/xmlschemas/ActivityExtensionv2.xsd">
  <Activities>
    <Activity Sport="Biking">
      <Id>${startTimeIso}</Id>
      <Lap StartTime="${startTimeIso}">
        <TotalTimeSeconds>${totalTimeSeconds}</TotalTimeSeconds>
        <DistanceMeters>${distanceMeters.toFixed(1)}</DistanceMeters>
        <MaximumSpeed>${maxSpeedMps.toFixed(2)}</MaximumSpeed>
        <Calories>${calories}</Calories>
        ${
          hrCount > 0
            ? `<AverageHeartRateBpm>
          <Value>${avgHr}</Value>
        </AverageHeartRateBpm>
        <MaximumHeartRateBpm>
          <Value>${maxHr}</Value>
        </MaximumHeartRateBpm>`
            : ''
        }
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
${trackpointsXml}
        </Track>
      </Lap>
      <Notes>${escapeXml(workoutName)}</Notes>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
}

// Garmin FIT CRC-16 Table (X.25 / CCITT nibble lookup)
const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400
];

function updateFitCrc(crc: number, byte: number): number {
  let tmp = CRC_TABLE[crc & 0xf];
  crc = (crc >> 4) & 0x0fff;
  crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf];

  tmp = CRC_TABLE[crc & 0xf];
  crc = (crc >> 4) & 0x0fff;
  crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  return crc;
}

function computeFitCrc(bytes: Uint8Array, start = 0, length = bytes.length): number {
  let crc = 0;
  for (let i = start; i < start + length; i++) {
    crc = updateFitCrc(crc, bytes[i]);
  }
  return crc;
}

class BinaryFitWriter {
  private buffer: Uint8Array;
  private offset = 0;

  constructor(initialCapacity = 65536) {
    this.buffer = new Uint8Array(initialCapacity);
  }

  private ensure(additionalBytes: number) {
    if (this.offset + additionalBytes > this.buffer.length) {
      const next = new Uint8Array(Math.max(this.buffer.length * 2, this.offset + additionalBytes + 4096));
      next.set(this.buffer);
      this.buffer = next;
    }
  }

  writeUint8(val: number) {
    this.ensure(1);
    this.buffer[this.offset++] = val & 0xff;
  }

  writeUint16LE(val: number) {
    this.ensure(2);
    this.buffer[this.offset++] = val & 0xff;
    this.buffer[this.offset++] = (val >> 8) & 0xff;
  }

  writeUint32LE(val: number) {
    this.ensure(4);
    this.buffer[this.offset++] = val & 0xff;
    this.buffer[this.offset++] = (val >> 8) & 0xff;
    this.buffer[this.offset++] = (val >> 16) & 0xff;
    this.buffer[this.offset++] = (val >>> 24) & 0xff;
  }

  writeBytes(bytes: number[] | Uint8Array) {
    this.ensure(bytes.length);
    this.buffer.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  patchUint32LE(pos: number, val: number) {
    this.buffer[pos] = val & 0xff;
    this.buffer[pos + 1] = (val >> 8) & 0xff;
    this.buffer[pos + 2] = (val >> 16) & 0xff;
    this.buffer[pos + 3] = (val >>> 24) & 0xff;
  }

  patchUint16LE(pos: number, val: number) {
    this.buffer[pos] = val & 0xff;
    this.buffer[pos + 1] = (val >> 8) & 0xff;
  }

  getUint8Array(): Uint8Array {
    return this.buffer.subarray(0, this.offset);
  }
}

function bufferToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Builds a valid standard binary FIT file representing the cycling workout activity,
 * and returns it encoded as a Base64 string.
 */
export function generateFitBase64(workoutName: string, samples: RecordedSample[]): string {
  const safeSamples = samples ?? [];
  const writer = new BinaryFitWriter(Math.max(4096, safeSamples.length * 20 + 512));

  // FIT epoch offset: 1989-12-31 00:00:00 UTC = 631065600 seconds after Unix epoch
  const FIT_EPOCH_OFFSET = 631065600;

  const startMs = safeSamples[0]?.timestampMs ?? Date.now();
  const startUnixSec = Math.floor(startMs / 1000);
  const startFitEpoch = Math.max(0, startUnixSec - FIT_EPOCH_OFFSET);

  const lastSample = safeSamples[safeSamples.length - 1];
  const endMs = lastSample?.timestampMs ?? startMs;
  const endUnixSec = Math.floor(endMs / 1000);
  const endFitEpoch = Math.max(0, endUnixSec - FIT_EPOCH_OFFSET);

  const totalTimeSeconds = lastSample ? Math.max(0, lastSample.elapsedSec) : 0;
  const totalDistanceMeters = lastSample ? Math.max(0, lastSample.distanceMeters) : 0;

  let maxSpeedMps = 0;
  let totalWatts = 0;
  let maxWatts = 0;
  let hrSum = 0;
  let hrCount = 0;
  let maxHr = 0;
  let cadSum = 0;
  let cadCount = 0;
  let maxCad = 0;

  for (const s of safeSamples) {
    const spd = (s.speedKmh ?? 0) / 3.6;
    if (spd > maxSpeedMps) maxSpeedMps = spd;

    const w = Math.max(0, s.powerWatts ?? 0);
    totalWatts += w;
    if (w > maxWatts) maxWatts = w;

    if (s.heartRateBpm && s.heartRateBpm > 0) {
      hrSum += s.heartRateBpm;
      hrCount++;
      if (s.heartRateBpm > maxHr) maxHr = s.heartRateBpm;
    }

    if (s.cadenceRpm && s.cadenceRpm > 0) {
      cadSum += s.cadenceRpm;
      cadCount++;
      if (s.cadenceRpm > maxCad) maxCad = s.cadenceRpm;
    }
  }

  const sampleCount = Math.max(1, safeSamples.length);
  const avgWatts = Math.round(totalWatts / sampleCount);
  const avgSpeedMps = totalTimeSeconds > 0 ? totalDistanceMeters / totalTimeSeconds : 0;
  const avgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : 0;
  const avgCad = cadCount > 0 ? Math.round(cadSum / cadCount) : 0;
  const calories = Math.round((avgWatts * totalTimeSeconds) / 1000);

  // Normalized power approximation (or avgWatts if short)
  const normPower = avgWatts;

  // 1. FIT Header (14 bytes)
  // [0] Header size: 14
  // [1] Protocol version: 0x20 (2.0)
  // [2..3] Profile version: 2160 (uint16 LE)
  // [4..7] Data size: uint32 LE placeholder
  // [8..11] DataType: ".FIT" [0x2E, 0x46, 0x49, 0x54]
  // [12..13] Header CRC: uint16 LE placeholder
  writer.writeUint8(14);
  writer.writeUint8(0x20);
  writer.writeUint16LE(2160);
  writer.writeUint32LE(0); // placeholder at offset 4
  writer.writeBytes([0x2e, 0x46, 0x49, 0x54]);
  writer.writeUint16LE(0); // placeholder at offset 12

  // 2. File ID Message (Global Mesg 0, Local Mesg 0)
  // Definition: Header 0x40, Reserved 0x00, Arch 0x00, MesgNum 0 (0x0000), 5 fields
  writer.writeBytes([0x40, 0x00, 0x00, 0x00, 0x00, 0x05]);
  // Field 0: type (enum, 1 byte, 0x00)
  writer.writeBytes([0x00, 0x01, 0x00]);
  // Field 1: manufacturer (uint16, 2 bytes, 0x84)
  writer.writeBytes([0x01, 0x02, 0x84]);
  // Field 2: product (uint16, 2 bytes, 0x84)
  writer.writeBytes([0x02, 0x02, 0x84]);
  // Field 3: serial_number (uint32z, 4 bytes, 0x8c)
  writer.writeBytes([0x03, 0x04, 0x8c]);
  // Field 4: time_created (uint32, 4 bytes, 0x86)
  writer.writeBytes([0x04, 0x04, 0x86]);

  // Data: Local Mesg 0
  writer.writeUint8(0x00);
  writer.writeUint8(4); // type = 4 (Activity)
  writer.writeUint16LE(1); // manufacturer = Garmin
  writer.writeUint16LE(0); // product = 0
  writer.writeUint32LE(123456); // serial
  writer.writeUint32LE(startFitEpoch); // time_created

  // 3. Record Message (Global Mesg 20, Local Mesg 1)
  // Definition: Header 0x41, Reserved 0x00, Arch 0x00, MesgNum 20 (0x0014), 6 fields
  writer.writeBytes([0x41, 0x00, 0x00, 0x14, 0x00, 0x06]);
  // Field 253: timestamp (uint32, 4 bytes, 0x86)
  writer.writeBytes([0xfd, 0x04, 0x86]);
  // Field 5: distance (uint32, 4 bytes, 0x86, scale 100 m)
  writer.writeBytes([0x05, 0x04, 0x86]);
  // Field 6: speed (uint16, 2 bytes, 0x84, scale 1000 m/s)
  writer.writeBytes([0x06, 0x02, 0x84]);
  // Field 7: power (uint16, 2 bytes, 0x84, Watts)
  writer.writeBytes([0x07, 0x02, 0x84]);
  // Field 3: cadence (uint8, 1 byte, 0x02, RPM)
  writer.writeBytes([0x03, 0x01, 0x02]);
  // Field 4: heart_rate (uint8, 1 byte, 0x02, BPM)
  writer.writeBytes([0x04, 0x01, 0x02]);

  // Data records
  for (const s of safeSamples) {
    const sampleEpoch = Math.max(0, Math.floor(s.timestampMs / 1000) - FIT_EPOCH_OFFSET);
    const distM100 = Math.max(0, Math.round((s.distanceMeters ?? 0) * 100));
    const speedMps1000 = Math.max(0, Math.round(((s.speedKmh ?? 0) / 3.6) * 1000));
    const pwr = Math.max(0, Math.min(65535, Math.round(s.powerWatts ?? 0)));
    const cad = Math.max(0, Math.min(255, Math.round(s.cadenceRpm ?? 0)));
    const hr = Math.max(0, Math.min(255, Math.round(s.heartRateBpm ?? 0)));

    writer.writeUint8(0x01); // Local Mesg 1 Data
    writer.writeUint32LE(sampleEpoch);
    writer.writeUint32LE(distM100);
    writer.writeUint16LE(speedMps1000);
    writer.writeUint16LE(pwr);
    writer.writeUint8(cad);
    writer.writeUint8(hr);
  }

  // 4. Lap Message (Global Mesg 19, Local Mesg 2)
  // Definition: Header 0x42, Reserved 0x00, Arch 0x00, MesgNum 19 (0x0013), 16 fields
  writer.writeBytes([0x42, 0x00, 0x00, 0x13, 0x00, 0x10]);
  writer.writeBytes([0xfd, 0x04, 0x86]); // timestamp
  writer.writeBytes([0x00, 0x01, 0x00]); // event (9 = lap)
  writer.writeBytes([0x01, 0x01, 0x00]); // event_type (1 = stop)
  writer.writeBytes([0x02, 0x04, 0x86]); // start_time
  writer.writeBytes([0x07, 0x04, 0x86]); // total_elapsed_time (scale 1000)
  writer.writeBytes([0x08, 0x04, 0x86]); // total_timer_time (scale 1000)
  writer.writeBytes([0x09, 0x04, 0x86]); // total_distance (scale 100)
  writer.writeBytes([0x0b, 0x02, 0x84]); // total_calories
  writer.writeBytes([0x0d, 0x02, 0x84]); // avg_speed (scale 1000)
  writer.writeBytes([0x0e, 0x02, 0x84]); // max_speed (scale 1000)
  writer.writeBytes([0x13, 0x02, 0x84]); // avg_power
  writer.writeBytes([0x14, 0x02, 0x84]); // max_power
  writer.writeBytes([0x0f, 0x01, 0x02]); // avg_cadence
  writer.writeBytes([0x10, 0x01, 0x02]); // max_cadence
  writer.writeBytes([0x11, 0x01, 0x02]); // avg_heart_rate
  writer.writeBytes([0x12, 0x01, 0x02]); // max_heart_rate

  // Data: Local Mesg 2
  writer.writeUint8(0x02);
  writer.writeUint32LE(endFitEpoch);
  writer.writeUint8(9); // event: lap
  writer.writeUint8(1); // event_type: stop
  writer.writeUint32LE(startFitEpoch);
  writer.writeUint32LE(totalTimeSeconds * 1000);
  writer.writeUint32LE(totalTimeSeconds * 1000);
  writer.writeUint32LE(Math.round(totalDistanceMeters * 100));
  writer.writeUint16LE(calories);
  writer.writeUint16LE(Math.round(avgSpeedMps * 1000));
  writer.writeUint16LE(Math.round(maxSpeedMps * 1000));
  writer.writeUint16LE(avgWatts);
  writer.writeUint16LE(maxWatts);
  writer.writeUint8(avgCad);
  writer.writeUint8(maxCad);
  writer.writeUint8(avgHr);
  writer.writeUint8(maxHr);

  // 5. Session Message (Global Mesg 18, Local Mesg 3)
  // Definition: Header 0x43, Reserved 0x00, Arch 0x00, MesgNum 18 (0x0012), 20 fields
  writer.writeBytes([0x43, 0x00, 0x00, 0x12, 0x00, 0x14]);
  writer.writeBytes([0xfd, 0x04, 0x86]); // timestamp
  writer.writeBytes([0x00, 0x01, 0x00]); // event (8 = session)
  writer.writeBytes([0x01, 0x01, 0x00]); // event_type (1 = stop)
  writer.writeBytes([0x02, 0x04, 0x86]); // start_time
  writer.writeBytes([0x05, 0x01, 0x00]); // sport (2 = cycling)
  writer.writeBytes([0x06, 0x01, 0x00]); // sub_sport (6 = indoor_cycling)
  writer.writeBytes([0x07, 0x04, 0x86]); // total_elapsed_time
  writer.writeBytes([0x08, 0x04, 0x86]); // total_timer_time
  writer.writeBytes([0x09, 0x04, 0x86]); // total_distance
  writer.writeBytes([0x0b, 0x02, 0x84]); // total_calories
  writer.writeBytes([0x0e, 0x02, 0x84]); // avg_speed
  writer.writeBytes([0x0f, 0x02, 0x84]); // max_speed
  writer.writeBytes([0x14, 0x02, 0x84]); // avg_power
  writer.writeBytes([0x15, 0x02, 0x84]); // max_power
  writer.writeBytes([0x10, 0x01, 0x02]); // avg_cadence
  writer.writeBytes([0x11, 0x01, 0x02]); // max_cadence
  writer.writeBytes([0x12, 0x01, 0x02]); // avg_heart_rate
  writer.writeBytes([0x13, 0x01, 0x02]); // max_heart_rate
  writer.writeBytes([0x16, 0x02, 0x84]); // normalized_power
  writer.writeBytes([0x19, 0x02, 0x84]); // num_laps

  // Data: Local Mesg 3
  writer.writeUint8(0x03);
  writer.writeUint32LE(endFitEpoch);
  writer.writeUint8(8); // event: session
  writer.writeUint8(1); // event_type: stop
  writer.writeUint32LE(startFitEpoch);
  writer.writeUint8(2); // sport: cycling
  writer.writeUint8(6); // sub_sport: indoor_cycling
  writer.writeUint32LE(totalTimeSeconds * 1000);
  writer.writeUint32LE(totalTimeSeconds * 1000);
  writer.writeUint32LE(Math.round(totalDistanceMeters * 100));
  writer.writeUint16LE(calories);
  writer.writeUint16LE(Math.round(avgSpeedMps * 1000));
  writer.writeUint16LE(Math.round(maxSpeedMps * 1000));
  writer.writeUint16LE(avgWatts);
  writer.writeUint16LE(maxWatts);
  writer.writeUint8(avgCad);
  writer.writeUint8(maxCad);
  writer.writeUint8(avgHr);
  writer.writeUint8(maxHr);
  writer.writeUint16LE(normPower);
  writer.writeUint16LE(1); // num_laps = 1

  // 6. Activity Message (Global Mesg 34, Local Mesg 4)
  // Definition: Header 0x44, Reserved 0x00, Arch 0x00, MesgNum 34 (0x0022), 6 fields
  writer.writeBytes([0x44, 0x00, 0x00, 0x22, 0x00, 0x06]);
  writer.writeBytes([0xfd, 0x04, 0x86]); // timestamp
  writer.writeBytes([0x00, 0x04, 0x86]); // total_timer_time
  writer.writeBytes([0x01, 0x02, 0x84]); // num_sessions
  writer.writeBytes([0x02, 0x01, 0x00]); // type (0 = manual)
  writer.writeBytes([0x03, 0x01, 0x00]); // event (26 = activity)
  writer.writeBytes([0x04, 0x01, 0x00]); // event_type (1 = stop)

  // Data: Local Mesg 4
  writer.writeUint8(0x04);
  writer.writeUint32LE(endFitEpoch);
  writer.writeUint32LE(totalTimeSeconds * 1000);
  writer.writeUint16LE(1); // num_sessions = 1
  writer.writeUint8(0); // type = manual
  writer.writeUint8(26); // event = activity
  writer.writeUint8(1); // event_type = stop

  // Patch Header fields:
  // Data size = total bytes minus 14-byte header
  const rawBytes = writer.getUint8Array();
  const dataSize = rawBytes.length - 14;
  writer.patchUint32LE(4, dataSize);

  // Compute Header CRC on bytes 0..11
  const headerCrc = computeFitCrc(rawBytes, 0, 12);
  writer.patchUint16LE(12, headerCrc);

  // Compute File CRC on all data up to this point (from byte 0 to offset - 1)
  const currentBytes = writer.getUint8Array();
  const fileCrc = computeFitCrc(currentBytes, 0, currentBytes.length);
  writer.writeUint16LE(fileCrc);

  const finalFitBytes = writer.getUint8Array();
  return bufferToBase64(finalFitBytes);
}
