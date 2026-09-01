// ── Product Registry ──────────────────────────────────────────────────────────

export interface RepoRef {
  key: string;
  owner: string;
  repo: string;
  required?: boolean;
  versionFile?: string;
  githubUrl?: string;
  localPaths?: string[];
}

export interface MtmPlan {
  id: number;
  name: string;
  adoProject: string;
  url?: string;
}

export interface ProductGroup {
  id: string;
  name: string;           // e.g. "AMB Group"
  productIds: string[];
}

export interface ProductSkillRef {
  path: string;
  role: 'primary' | 'secondary';
  enabled?: boolean;
}

export interface PastedSkillMdRef {
  title: string;
  content: string;
  role: 'primary' | 'secondary';
  enabled?: boolean;
}

export interface Product {
  id: string;
  displayName: string;
  areaPathPrefix: string;
  areaPathPrefixes?: string[];  // additional area path prefixes
  databaseRepoPaths?: string[];
  snowProduct: string;
  snowTaskTable: 'incident_task' | 'sc_task';
  repos: RepoRef[];
  mtmPlans: MtmPlan[];
  skillPath?: string;           // legacy
  skillPaths?: string[];        // multiple local skill/MD file paths
  localSkills?: ProductSkillRef[];   // explicit local skill file paths
  githubSkillPaths?: string[];  // multiple GitHub paths for devassist skill files/folders
  githubSkills?: ProductSkillRef[]; // prioritized GitHub skill paths
  pastedSkillMd?: PastedSkillMdRef[]; // pasted markdown skill blocks
  docUrl?: string;
  localFolder?: string;         // local DA folder, e.g. C:\temp\DA#
  notes?: string;
}

export interface ProductRegistry {
  version: number;
  products: Product[];
  groups?: ProductGroup[];
}

// ── ADO Work Item ─────────────────────────────────────────────────────────────

export interface AdoWorkItem {
  id: number;
  fields: {
    // Core
    'System.Title': string;
    'System.AreaPath': string;
    'System.State': string;
    'System.WorkItemType': string;
    'System.AssignedTo'?: { displayName: string; uniqueName: string };
    'System.Description'?: string;
    'System.History'?: string;
    // Altera support fields (all read from DA per SKILL.md §0c)
    'Allscripts.Field.IncidentTaskID'?: string;      // TASK…
    'Allscripts.Field.CaseId'?: string;              // CS…
    'Allscripts.Field.SnowProduct'?: string;
    'Allscripts.Field.CustomerName'?: string;
    'Allscripts.Field.SupportVersion'?: string;
    'Allscripts.Field.DevNotes'?: string;
    'Allscripts.Field.WorkaroundInstructions'?: string;
    'Allscripts.Field.DALinks'?: string;
    'Allscripts.Field.DevAssistReason'?: string;
    'Allscripts.Field.CommentaryforL2'?: string;     // where L2 replies are posted
    'Allscripts.Field.SupportPriority'?: string;
    'Microsoft.VSTS.Common.Severity'?: string;
    'Microsoft.VSTS.Common.ReproSteps'?: string;
    'Allscripts.Field.DevAssistDetail'?: string;
    [key: string]: unknown;
  };
  _links?: { html?: { href: string } };
}

// ── SNOW Records ─────────────────────────────────────────────────────────────

export interface SnowField {
  display_value: string;
  value: string;
}

/** Raw SNOW record — all fields are {display_value, value} objects or strings */
export interface SnowTask {
  number: string | SnowField;
  short_description: string | SnowField;
  description: string | SnowField;
  state: string | SnowField;
  work_notes: string | SnowField;
  close_notes?: string | SnowField;
  sys_id: string | SnowField;
  incident?: string | SnowField;
  'incident.number'?: string | SnowField;
  'incident.sys_id'?: string | SnowField;
  [key: string]: unknown;
}

export interface SnowAttachment {
  file_name: string | SnowField;
  content_type: string | SnowField;
  size_bytes: string | SnowField;
  sys_id: string | SnowField;          // attachment sys_id — use for GetAttachment
  // NOTE: download_link points at service-now.com (SSO blocked) — use bridge /attachment/:sys_id
}

// ── Triage Analysis ────────────────────────────────────────────────────────────

export type TriageVerdict =
  | 'CODE BUG'
  | 'CONFIG / INSTALL'
  | 'INTENDED BEHAVIOR'
  | 'ENHANCEMENT'
  | 'NEED MORE INFO'
  | null;

export type TriageConfidence = 'High' | 'Medium' | 'Low' | null;

export interface TriageAnalysis {
  verdict: TriageVerdict;
  confidence: TriageConfidence;
  clientReported: string;
  snowEvidence: string[];
  codeAnalysis: string;
  gap: string;
  blindSpots: string[];
  l2Draft?: string;               // human-gated — shown for approval, never auto-posted
  defectDraft?: {
    title: string;
    areaPath: string;
    description: string;
  };
}

export interface ArtifactLedger {
  analyzed: Array<{ source: string; file: string; type: string; finding: string }>;
  notAnalyzed: Array<{ source: string; file: string; type: string; reason: string }>;
  coverageTimeframe: 'ok' | string;   // 'ok' or gap description
  coverageSubject: 'ok' | string;
}

// ── Triage Session ────────────────────────────────────────────────────────────

export type InputType = 'DA' | 'INC' | 'TASK' | 'CS' | 'KB' | 'TFS' | 'unknown';

export type SessionPhase =
  | 'preflight'    // Phase 0·pre
  | 'reading'      // Phase 0c — fetch DA
  | 'routing'      // Phase 0d — area pack
  | 'snow'         // Phase 0e — pull SNOW
  | 'clarity'      // Phase 1
  | 'artifacts'    // Phase 2
  | 'analysis'     // Phase 3/4
  | 'done';

export interface TriageSession {
  id: string;
  inputRaw: string;
  inputType: InputType;
  selectedReportedReleases?: string[];
  currentPhase: SessionPhase;
  workItemId?: number;
  snowTaskNumber?: string;
  snowIncidentNumber?: string;
  snowCaseNumber?: string;
  product?: Product;
  adoItem?: AdoWorkItem;
  snowTask?: SnowTask;
  snowTaskTable?: 'incident_task' | 'sc_task' | 'u_pltf_task' | 'change_task' | 'sc_req_item' | 'sn_customerservice_task' | string;
  snowFetchError?: string;
  snowIncident?: SnowTask;
  snowCase?: SnowTask;
  attachments?: SnowAttachment[];
  analysis?: TriageAnalysis;
  artifactLedger?: ArtifactLedger;
  clarityGaps?: string[];
  relatedItems?: import('../lib/ado-client').RelatedItem[];  // open bugs same area
  testCases?: import('../lib/ado-client').RelatedItem[];    // test cases same area
  areaEvidence?: import('../lib/ado-client').RelatedItem[]; // recent defects/bugs/tasks same area
  versionEvidence?: import('../lib/ado-client').RelatedItem[]; // area evidence filtered by version hints
  databaseEvidence?: Array<{ repo: string; path: string; url: string }>; // DB repo hits
  kbEvidence?: Array<{ number: string; shortDescription: string; state: string; updatedOn: string }>; // SNOW KB related entries
  recentCommits?: Array<{ sha: string; message: string; date: string; url: string }>;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  startedAt: string;
}

// ── Bridge Status ─────────────────────────────────────────────────────────────

export interface BridgeStatus {
  bridge: 'ok' | 'offline';
  version?: string;
  platform?: string;
  snowAuth?: string;
  adoAuth?: string;
  githubAuth?: string;
  timestamp?: string;
}