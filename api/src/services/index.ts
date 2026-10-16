import type { AppConfig } from '../config';
import type { Database } from '../db';
import { AppointmentService } from './appointmentService';
import { DashboardService } from './dashboardService';
import { DoctorService } from './doctorService';
import { PatientService } from './patientService';
import { ReferenceService } from './referenceService';

export interface Services {
  departments: ReferenceService;
  specializations: ReferenceService;
  doctors: DoctorService;
  patients: PatientService;
  appointments: AppointmentService;
  dashboard: DashboardService;
}

export interface AppContext {
  db: Database;
  config: AppConfig;
  clock: () => Date;
  services: Services;
}

/** `clock` is injectable so tests can fix "now"; production uses the real time. */
export function createContext(db: Database, config: AppConfig, clock: () => Date = () => new Date()): AppContext {
  return {
    db,
    config,
    clock,
    services: {
      departments: new ReferenceService(db, 'department'),
      specializations: new ReferenceService(db, 'specialization'),
      doctors: new DoctorService(db, config, clock),
      patients: new PatientService(db, config, clock),
      appointments: new AppointmentService(db, config, clock),
      dashboard: new DashboardService(db, config, clock),
    },
  };
}
