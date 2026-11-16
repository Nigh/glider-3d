import { defaultAircraft } from '../../src/model';
import { FlightSimulation } from '../../src/physics';
import { exportReplay } from '../../src/replay';

export async function createLegacyReplay(): Promise<string> {
 const simulation = new FlightSimulation(defaultAircraft, 'birdman', 0);
 for (let tick = 0; tick < 10; tick++) simulation.step({ weight: 0, elevator: 0, aileron: 0, rudder: 0 });
 const data = JSON.parse(await exportReplay({ definition: defaultAircraft, challenge: 'birdman', recording: simulation.getRecording() }));
 delete data.recording.ghostEncoding;
 delete data.recording.ghostData;
 delete data.recording.checkpointTimes;
 return JSON.stringify(data);
}
