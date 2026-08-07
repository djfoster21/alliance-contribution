import { ActivityRepo } from "../repositories/activity-repo";
import { AliasRepo } from "../repositories/alias-repo";
import { AllocationRepo } from "../repositories/allocation-repo";
import { BackupRepo } from "../repositories/backup-repo";
import { EventRepo } from "../repositories/event-repo";
import { MemberRepo } from "../repositories/member-repo";
import { ParticipationRepo } from "../repositories/participation-repo";
import { ScoringTierRepo } from "../repositories/scoring-tier-repo";
import { SettingsRepo } from "../repositories/settings-repo";
import { SnapshotRepo } from "../repositories/snapshot-repo";
import { StatsRepo } from "../repositories/stats-repo";
import { ActivityService } from "./activity-service";
import { AliasService } from "./alias-service";
import { AllocationService } from "./allocation-service";
import { BackupService } from "./backup-service";
import { EventService } from "./event-service";
import { MemberService } from "./member-service";
import { RecomputeService } from "./recompute-service";
import { ResolveService } from "./resolve-service";
import { ScoringService } from "./scoring-service";
import { SettingsService } from "./settings-service";
import { StatsService } from "./stats-service";

// Composition root: wires repositories and services in dependency order.
export function createServices(db: D1Database) {
  const memberRepo = new MemberRepo(db);
  const aliasRepo = new AliasRepo(db);
  const activityRepo = new ActivityRepo(db);
  const scoringTierRepo = new ScoringTierRepo(db);
  const eventRepo = new EventRepo(db);
  const participationRepo = new ParticipationRepo(db);
  const snapshotRepo = new SnapshotRepo(db);
  const statsRepo = new StatsRepo(db);
  const backupRepo = new BackupRepo(db);
  const allocationRepo = new AllocationRepo(db);

  const resolveService = new ResolveService(aliasRepo, memberRepo);
  const scoringService = new ScoringService(scoringTierRepo, activityRepo);
  const recomputeService = new RecomputeService(participationRepo, resolveService, scoringService);
  scoringService.setRecompute(recomputeService);

  return {
    memberService: new MemberService(memberRepo, aliasRepo, snapshotRepo, allocationRepo, recomputeService),
    aliasService: new AliasService(aliasRepo, memberRepo, participationRepo, recomputeService),
    activityService: new ActivityService(activityRepo, eventRepo, recomputeService),
    scoringService,
    eventService: new EventService(
      eventRepo,
      participationRepo,
      activityRepo,
      resolveService,
      recomputeService,
    ),
    resolveService,
    recomputeService,
    statsService: new StatsService(statsRepo),
    settingsService: new SettingsService(new SettingsRepo(db)),
    backupService: new BackupService(backupRepo, recomputeService),
    allocationService: new AllocationService(allocationRepo, statsRepo),
  };
}
