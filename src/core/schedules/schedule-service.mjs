// Compatibility entry point for callers that still pass a state directory.
import {ScheduleService as ApplicationScheduleService} from '../../application/schedules/schedule-service.mjs'
import {createScheduleStateStore} from '../../infrastructure/storage/schedule-state.mjs'

export class ScheduleService extends ApplicationScheduleService {
  constructor({stateDir, stateStore = createScheduleStateStore(stateDir), ...options}) {
    super({stateStore, ...options})
  }
}
