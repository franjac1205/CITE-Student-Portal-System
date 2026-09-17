import { useEffect, useMemo, useState, type FormEvent } from "react";
import bcrypt from "bcryptjs";
import { AlertTriangle, ArrowRight, BarChart2, Calendar, CheckCircle2, DollarSign, FileText, LayoutGrid, LogOut, Megaphone, Shield, Sparkles, User, X } from "lucide-react";
import { cashflowSupabase, supabase } from "../supabaseClient";

type Role = "student" | "officer" | "president" | "finance";
type UserSource = "users" | "students";
type Section = "dashboard" | "profile" | "events" | "announcements" | "money" | "rankings";
type PaymentType = "Fee" | "Fine" | "Contribution";

interface UserRecord {
  id: string;
  email: string;
  username: string;
  studentId: string;
  firstName: string;
  lastName: string;
  password: string;
  role: Role;
  roleName: string;
  source: UserSource;
}

interface EventRecord {
  id: string;
  title: string;
  dateTime: string;
  requiredTimeIn: string | null;
  requiredTimeOut: string | null;
  lateThresholdMinutes: number;
  venue: string;
  createdBy: string;
}

interface EventAttendanceRecord {
  id: string;
  eventId: string;
  studentId: string;
  timeIn: string | null;
  timeOut: string | null;
  status: string;
  calculatedFine: number;
  calculatedCsHours: number;
  createdAt: string | null;
}

interface AnnouncementRecord {
  id: string;
  title: string;
  content: string;
  authorId: string;
  createdAt: string;
  imageUrl?: string | null;
}

interface Payment {
  id: string;
  userId: string;
  title: string;
  type: PaymentType;
  amount: number;
  status: "pending" | "paid";
  eventId?: string;
  paymentDate?: string;
  remarks?: string | null;
  ledgerKind?: "income" | "expense" | "student_payment" | "fine" | "violation";
  remainingAmount?: number;
}

interface FineSettings {
  late: number;
  absent: number;
  wrongAttire: number;
}

interface LiquidationRecord {
  id: number | string;
  budget_request_id?: number | string | null;
  actual_amount_spent?: number | string | null;
  proof_filenames?: string | null;
  remarks?: string | null;
  submitted_by?: number | string | null;
  date_submitted?: string | null;
  status?: string | null;
  reviewed_by?: number | string | null;
  date_reviewed?: string | null;
  is_final?: boolean | null;
  rejection_reason?: string | null;
}

interface ExcuseRequestRecord {
  id: string;
  eventId: string;
  requestedBy: string;
  status: string;
  approvalAction: string;
  reason: string | null;
  excuseLetter: string | null;
  excuseLetterName: string | null;
  excuseLetterMime: string | null;
  supportingDocument: string | null;
  supportingDocumentName: string | null;
  supportingDocumentMime: string | null;
  createdAt: string | null;
  reviewedBy: string | null;
  decisionNotes: string | null;
  decidedAt: string | null;
}

interface FeedbackState {
  tone: "success" | "error";
  message: string;
  details?: string;
  hint?: string;
}

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutGrid },
  { id: "profile", label: "Profile", icon: User },
  { id: "events", label: "Events", icon: Calendar },
  { id: "announcements", label: "Announcements", icon: Megaphone },
  { id: "money", label: "Money Talks", icon: DollarSign },
  { id: "rankings", label: "Rankings", icon: BarChart2 },
] as const;

const currency = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

const ANNOUNCEMENT_IMAGE_BUCKET = "announcement-images";
const EXCUSE_REQUEST_BUCKET = "excuse-request-files";
const ABSENT_ATTENDANCE_FINE = 300;

const parseEventDate = (value: string) => {
  const dateValue = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
    ? new Date(`${dateValue}T00:00:00`)
    : new Date(dateValue);
};

const startOfToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.getTime();
};

const fmtDateTime = (iso: string) =>
  parseEventDate(iso).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const attendanceStatusClass = (status: string, hasTimeOut: boolean) => {
  if (!hasTimeOut && status === "Absent") return "text-rose-300";

  switch (status) {
    case "Present":
      return "text-emerald-300";
    case "Late":
      return "text-amber-300";
    case "Left Early":
      return "text-orange-300";
    case "Late and Left Early":
      return "text-red-300";
    case "Excused":
      return "text-sky-300";
    case "Absent":
      return "text-rose-300";
    default:
      return hasTimeOut ? "text-emerald-300" : "text-slate-300";
  }
};

const normalizePaymentType = (value?: string | null): PaymentType => {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (normalized.includes("fine")) return "Fine";
  if (normalized.includes("contribution")) return "Contribution";
  if (normalized.includes("fee")) return "Fee";

  return "Fee";
};

const normalizePaymentStatus = (amount: number, type: PaymentType, value?: string | null): "pending" | "paid" => {
  if (amount === 0 && (type === "Fine" || type === "Contribution")) return "paid";
  return String(value ?? "paid").toLowerCase() === "paid" ? "paid" : "pending";
};

const extractStudentIdFromDescription = (value?: string | null) => {
  const match = String(value ?? "").match(/\(\s*(\d{3}-\d{2}-\d{4})\s*\)/);
  return match?.[1] ?? null;
};

const paymentTypeLabel = (type: PaymentType | string) => {
  const normalized = String(type ?? "Fee").trim();
  if (normalized.toLowerCase().includes("fine")) return "Fines";
  if (normalized.toLowerCase().includes("contribution")) return "Contribution";
  return "Fees";
};

const roleLabel = (role: Role | string) => {
  const normalizedRole = String(role ?? "student").toLowerCase();

  if (normalizedRole.includes("finance")) return "Finance Officer";
  if (normalizedRole.includes("president")) return "President";
  if (normalizedRole.includes("officer")) return "Officer";
  if (normalizedRole.includes("student")) return "Student";

  return String(role || "Student");
};

const roleBadge = (role: Role | string) => {
  const normalizedRole = String(role ?? "student").toLowerCase();

  if (normalizedRole.includes("finance")) return "bg-slate-500/15 text-slate-300 border border-slate-500/30";
  if (normalizedRole.includes("president")) return "bg-red-600/15 text-red-400 border border-red-500/30";
  if (normalizedRole.includes("officer")) return "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30";
  return "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30";
};

const getRoleNameFromRow = (row: Record<string, any>) => {
  const roleNameCandidates = [
    row.role_name,
    row.roleName,
    row.roles?.name,
    row.roles?.[0]?.name,
    row["roles!users_role_id_fkey"]?.name,
    row["roles!users_role_id_fkey"]?.[0]?.name,
    row.role,
    row.name,
  ];

  const firstMeaningful = roleNameCandidates.find(
    (value) => typeof value === "string" && value.trim().length > 0
  );

  return String(firstMeaningful ?? "student").trim();
};

const getRoleDetails = (row: Record<string, any>) => {
  const roleNameSource = getRoleNameFromRow(row);

  const normalizedRole = roleNameSource.toLowerCase();
  const derivedRole = normalizedRole.includes("finance")
    ? "finance"
    : normalizedRole.includes("president")
    ? "president"
    : normalizedRole.includes("officer")
    ? "officer"
    : "student";

  return {
    roleName: roleNameSource || "Student",
    role: derivedRole as Role,
  };
};

const mapUser = (row: Record<string, any>): UserRecord => {
  const { roleName, role } = getRoleDetails(row);

  return {
    id: row.id,
    email: row.email ?? "",
    username: row.username ?? row.student_id ?? row.email ?? "",
    studentId: row.student_IDnumber ?? row.username ?? row.student_id ?? row.studentId ?? row.email ?? "",
    firstName: row.first_name ?? row.firstName ?? "",
    lastName: row.last_name ?? row.lastName ?? "",
    password: row.birthdate_password ?? row.password_hash ?? row.password ?? "",
    role,
    roleName,
    source: "users",
  };
};

const mapStudent = (row: Record<string, any>): UserRecord => ({
  id: row.id,
  email: row.email ?? "",
  username: row.username ?? row.student_IDnumber ?? row.studentId ?? row.email ?? "",
  studentId: row.username ?? row.student_IDnumber ?? row.studentId ?? row.email ?? "",
  firstName: row.first_name ?? row.firstName ?? "",
  lastName: row.last_name ?? row.lastName ?? "",
  password: row.student_IDnumber ?? "",
  role: "student",
  roleName: "Student",
  source: "students",
});

const mapEvent = (row: Record<string, any>): EventRecord => ({
  id: row.id,
  title: row.title ?? "Untitled",
  dateTime: row.date_time ?? row.dateTime ?? row.event_date ?? row.eventDate ?? new Date().toISOString(),
  requiredTimeIn: row.required_time_in ?? row.requiredTimeIn ?? null,
  requiredTimeOut: row.required_time_out ?? row.requiredTimeOut ?? null,
  lateThresholdMinutes: Number(row.late_threshold_minutes ?? row.lateThresholdMinutes ?? 15),
  venue: row.venue ?? "",
  createdBy: row.created_by ?? row.createdBy ?? "",
});

const mapEventAttendance = (row: Record<string, any>): EventAttendanceRecord => ({
  id: String(row.id ?? ""),
  eventId: String(row.event_id ?? row.eventId ?? ""),
  studentId: String(row.student_id ?? row.studentId ?? ""),
  timeIn: row.time_in ?? row.timeIn ?? null,
  timeOut: row.time_out ?? row.timeOut ?? null,
  status: row.status ?? "Absent",
  calculatedFine: Number(row.calculated_fine ?? row.calculatedFine ?? 0),
  calculatedCsHours: Number(row.calculated_cs_hours ?? row.calculatedCsHours ?? 0),
  createdAt: row.created_at ?? row.createdAt ?? null,
});

const getAttendanceStatus = (attendance: EventAttendanceRecord) =>
  !attendance.timeIn && !attendance.timeOut ? "Absent" : attendance.status;

const getAttendanceFine = (attendance: EventAttendanceRecord) =>
  !attendance.timeIn && !attendance.timeOut
    ? ABSENT_ATTENDANCE_FINE
    : attendance.calculatedFine;

const resolveStudentIdForUser = async (user: UserRecord) => {
  const [studentIdResult, studentEmailResult] = await Promise.all([
    user.studentId
      ? supabase
          .from("students")
          .select("id")
          .eq("student_IDnumber", user.studentId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    user.email
      ? supabase
          .from("students")
          .select("id")
          .eq("email", user.email)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (studentIdResult.error && studentEmailResult.error) {
    throw studentIdResult.error;
  }

  return studentIdResult.data?.id ?? studentEmailResult.data?.id ?? null;
};

const loadEventsFromSupabase = async () => {
  const preferred = await supabase
    .from("events")
    .select("id, title, event_date, required_time_in, required_time_out, late_threshold_minutes, venue, created_by")
    .order("event_date", { ascending: true });

  if (!preferred.error) return preferred;

  const lowered = (preferred.error.message ?? "").toLowerCase();
  if (lowered.includes("column") && lowered.includes("event_date")) {
    return supabase
      .from("events")
      .select("id, title, date_time, required_time_in, required_time_out, late_threshold_minutes, venue, created_by")
      .order("date_time", { ascending: true });
  }

  return preferred;
};

const mapAnnouncement = (row: Record<string, any>): AnnouncementRecord => ({
  id: row.id,
  title: row.title ?? "New update",
  content: row.message ?? row.content ?? "",
  authorId: row.created_by ?? row.author_id ?? row.authorId ?? "",
  createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
  imageUrl: row.image_url ?? row.imageUrl ?? null,
});

const uploadAnnouncementImage = async (file: File, userId: string) => {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please select a valid image file for the announcement.");
  }

  const safeUserId = String(userId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  const extension = file.name.includes(".") ? file.name.split(".").pop() ?? "jpg" : "jpg";
  const filePath = `${safeUserId}/${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;

  const { data, error } = await supabase.storage.from(ANNOUNCEMENT_IMAGE_BUCKET).upload(filePath, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "image/jpeg",
  });

  if (error) {
    throw new Error(`Announcement image upload failed: ${error.message}. Confirm the ${ANNOUNCEMENT_IMAGE_BUCKET} bucket exists and has an INSERT policy for the anon role.`);
  }
  if (!data?.path) throw new Error("The image upload succeeded but no file path was returned.");

  const { data: publicData } = supabase.storage.from(ANNOUNCEMENT_IMAGE_BUCKET).getPublicUrl(data.path);

  return { path: data.path, publicUrl: publicData.publicUrl };
};

const uploadExcuseRequestFile = async (file: File, userId: string, kind: "letter" | "signed-photo") => {
  const safeUserId = String(userId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = `${safeUserId}/${Date.now()}-${kind}-${Math.random().toString(16).slice(2)}-${safeName}`;
  const { data, error } = await supabase.storage.from(EXCUSE_REQUEST_BUCKET).upload(filePath, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "application/octet-stream",
  });

  if (error) {
    const loweredMessage = String(error.message ?? "").toLowerCase();
    const setupHint = loweredMessage.includes("bucket not found")
      ? `Run excuse-requests-supabase-fix.sql in the SQL Editor of the connected Supabase project to create the ${EXCUSE_REQUEST_BUCKET} bucket.`
      : `Confirm the ${EXCUSE_REQUEST_BUCKET} bucket exists and has an INSERT policy for the anon role.`;
    throw new Error(`Excuse request file upload failed: ${error.message}. ${setupHint}`);
  }

  return { path: data.path, name: file.name, mime: file.type || "application/octet-stream" };
};

const mapCollectionRow = (row: Record<string, any>): Payment => ({
  id: String(row.id ?? `${row.transaction_date ?? "collection"}-${row.reference_number ?? "record"}`),
  userId: row.recorded_by ?? "all",
  title: row.description?.trim() ? row.description.trim() : (row.reference_number ? `Collection ${row.reference_number}` : "Collection entry"),
  type: normalizePaymentType(row.transaction_type ?? row.category ?? "Fee"),
  amount: Number(row.amount ?? 0),
  status: "paid",
  eventId: row.reference_number ?? undefined,
  paymentDate: row.transaction_date ?? row.created_at ?? undefined,
  remarks: row.reference_number ?? null,
  ledgerKind: String(row.transaction_type ?? "income").toLowerCase() === "expense" ? "expense" : "income",
});

const mapFineRow = (row: Record<string, any>): Payment => ({
  id: String(row.id ?? `${row.student_id ?? "fine"}-${row.date_incurred ?? row.created_at ?? "record"}`),
  userId: String(row.student_id ?? ""),
  title: row.reason?.trim() ? row.reason.trim() : "Fine",
  type: "Fine",
  amount: Number(row.amount ?? 0),
  status: normalizePaymentStatus(Number(row.amount ?? 0), "Fine", row.status ?? "Unpaid"),
  eventId: row.attendance_id ?? undefined,
  paymentDate: row.date_incurred ?? row.paid_at ?? undefined,
  remarks: row.notes ?? row.waiver_reason ?? null,
  ledgerKind: "fine",
});

const mapStudentPaymentRow = (row: Record<string, any>): Payment => ({
  id: String(row.id ?? `${row.student_id ?? "payment"}-${row.payment_date ?? row.created_at ?? "record"}`),
  userId: String(row.student_id ?? ""),
  title: row.remarks?.trim()
    ? row.remarks.trim()
    : row.fund_categories?.name ?? row.category?.name ?? "Student payment",
  type: normalizePaymentType(
    row.fund_categories?.name
      ?? row.fund_categories?.[0]?.name
      ?? row.category?.name
      ?? row.category?.[0]?.name
      ?? row.transactions?.description
      ?? "Fee"
  ),
  amount: Number(row.amount ?? 0),
  status: "paid",
  eventId: row.transaction_id ?? undefined,
  paymentDate: row.payment_date ?? row.created_at ?? undefined,
  remarks: row.remarks ?? null,
  ledgerKind: "student_payment",
});

const mapViolationRow = (row: Record<string, any>): Payment => ({
  id: String(row.violation_id ?? row.id ?? `${row.student_id ?? "violation"}-${row.event_date ?? "record"}`),
  userId: String(row.student_id ?? ""),
  title: row.event_name?.trim() ? row.event_name.trim() : "Violation ledger",
  type: "Fine",
  amount: Number(row.assessed_fine ?? row.effective_fine_balance ?? row.amount ?? 0),
  status: normalizePaymentStatus(Number(row.assessed_fine ?? row.effective_fine_balance ?? row.amount ?? 0), "Fine", row.violation_status ?? "pending"),
  eventId: row.public_event_attendance_id ?? row.event_id ?? undefined,
  paymentDate: row.event_date ?? row.migrated_at ?? undefined,
  remarks: row.excuse_reason ?? row.excuse_decision_notes ?? null,
  ledgerKind: "violation",
});

const mapPayment = (row: Record<string, any>): Payment => ({
  id: row.id,
  userId: row.student_id ?? row.user_id ?? row.userId ?? "",
  title: row.remarks?.trim() ? row.remarks.trim() : `Payment ${row.payment_date ?? row.created_at ?? "record"}`,
  type: normalizePaymentType(
    row.type
      ?? row.category_name
      ?? row.category?.name
      ?? row.category?.[0]?.name
      ?? row.fund_categories?.name
      ?? row.fund_categories?.[0]?.name
      ?? row["fund_categories!student_payments_category_id_fkey"]?.name
      ?? row["fund_categories!student_payments_category_id_fkey"]?.[0]?.name
  ),
  amount: Number(row.amount ?? 0),
  status: normalizePaymentStatus(
    Number(row.amount ?? 0),
    normalizePaymentType(row.type ?? row.category_name ?? row.category?.name ?? row.category?.[0]?.name ?? row.fund_categories?.name ?? row.fund_categories?.[0]?.name ?? row["fund_categories!student_payments_category_id_fkey"]?.name ?? row["fund_categories!student_payments_category_id_fkey"]?.[0]?.name),
    row.status,
  ),
  eventId: row.transaction_id ?? row.transactionId,
  paymentDate: row.payment_date ?? row.created_at ?? undefined,
  remarks: row.remarks ?? null,
});

const mapFineSettings = (row: Record<string, any>): FineSettings => ({
  late: Number(row.late ?? 100),
  absent: Number(row.absent ?? 200),
  wrongAttire: Number(row.wrong_attire ?? row.wrongAttire ?? 50),
});

const mapExcuseRequest = (row: Record<string, any>): ExcuseRequestRecord => ({
  id: row.id,
  eventId: row.attendance_id ?? row.event_id ?? row.eventId ?? "",
  requestedBy: row.requested_by ?? row.requestedBy ?? "",
  status: row.status ?? "pending",
  approvalAction: row.approval_action ?? row.approvalAction ?? "excused",
  reason: row.reason ?? null,
  excuseLetter: row.excuse_letter ?? row.excuseLetter ?? null,
  excuseLetterName: row.excuse_letter_name ?? null,
  excuseLetterMime: row.excuse_letter_mime ?? null,
  supportingDocument: row.supporting_document ?? null,
  supportingDocumentName: row.supporting_document_name ?? null,
  supportingDocumentMime: row.supporting_document_mime ?? null,
  createdAt: row.created_at ?? row.createdAt ?? null,
  reviewedBy: row.reviewed_by ?? row.reviewedBy ?? null,
  decisionNotes: row.decision_notes ?? row.decisionNotes ?? null,
  decidedAt: row.decided_at ?? row.decidedAt ?? null,
});

const getAnnouncementErrorFeedback = (
  error: unknown,
  operation: "load" | "create" | "update" | "delete",
): FeedbackState => {
  const err = error as Record<string, any> | undefined;
  const rawMessage = err?.message ?? (error instanceof Error ? error.message : "Unknown Supabase error");
  const code = err?.code ?? "";
  const details = err?.details ?? "";
  const hint = err?.hint ?? "";
  const status = err?.status ?? "";
  const lowered = rawMessage.toLowerCase();

  let message = `Announcement ${operation} failed.`;
  let nextAction = "Inspect the Supabase response and table configuration.";

  if (code === "42501" || lowered.includes("permission denied") || lowered.includes("row-level security") || lowered.includes("rls")) {
    message = `Announcement ${operation} is blocked by table permissions.`;
    nextAction = "Enable RLS policies for public.announcements or allow the anon/authenticated role to read/write the table.";
  } else if (lowered.includes("bucket not found") || lowered.includes("storage bucket") || lowered.includes("bucket") && lowered.includes("not found")) {
    message = "The image storage bucket for announcements is missing.";
    nextAction = "Create a public Supabase Storage bucket named announcement-images in the Supabase dashboard, then retry the announcement upload.";
  } else if (lowered.includes("relation") && lowered.includes("announcements")) {
    message = "The announcements table could not be found in the connected Supabase project.";
    nextAction = "Create or restore the public.announcements table in the unified database before retrying.";
  } else if (lowered.includes("column") && (lowered.includes("created_by") || lowered.includes("author_id") || lowered.includes("publish_date") || lowered.includes("deleted_at") || lowered.includes("updated_at") || lowered.includes("type") || lowered.includes("priority") || lowered.includes("is_pinned"))) {
    message = "The announcements table is missing one or more required columns.";
    nextAction = "Add the missing announcements columns such as created_by/author_id, publish_date, deleted_at, and updated_at, then retry.";
  } else if (lowered.includes("jwt") || lowered.includes("api key") || lowered.includes("unauthorized") || lowered.includes("invalid token") || lowered.includes("no suitable key")) {
    message = "The Supabase credentials are not usable for this request.";
    nextAction = "Verify the VITE Supabase URL and anon key in the environment configuration.";
  } else if (lowered.includes("not found") && lowered.includes("schema")) {
    message = "The announcements table is not available in the schema being queried.";
    nextAction = "Confirm that the request is hitting the correct Supabase project and schema.";
  } else if (lowered.includes("duplicate key") || lowered.includes("unique constraint")) {
    message = "The announcement insert hit a database uniqueness rule.";
    nextAction = "Check whether the table or a generated value is violating a unique constraint.";
  } else if (lowered.includes("null value") || lowered.includes("not-null") || lowered.includes("violates not-null constraint")) {
    message = "The announcement payload is missing a required field.";
    nextAction = "Ensure title, content, and any required announcement columns are present before submitting.";
  } else if (lowered.includes("check constraint") || lowered.includes("violates check constraint")) {
    message = "The announcement payload violates a table check constraint.";
    nextAction = "Check the allowed values for fields like type and priority against the database rules.";
  } else if (lowered.includes("network") || lowered.includes("fetch failed") || lowered.includes("timeout")) {
    message = "The request could not reach Supabase successfully.";
    nextAction = "Check the network connection and confirm the Supabase endpoint is reachable.";
  }

  const diagnosticParts = [
    `Operation: ${operation}`,
    `Table: public.announcements`,
    `Supabase message: ${rawMessage}`,
    code ? `Code: ${code}` : "",
    status ? `Status: ${status}` : "",
    details ? `Details: ${details}` : "",
    hint ? `Hint: ${hint}` : "",
    `Next step: ${nextAction}`,
  ].filter(Boolean);

  return {
    tone: "error",
    message,
    details: diagnosticParts.join("\n"),
    hint: nextAction,
  };
};

const getDataLoadErrorFeedback = (error: unknown, source: "announcements" | "events" | "users" | "payments" | "fine_settings") => {
  const err = error as Record<string, any> | undefined;
  const rawMessage = err?.message ?? (error instanceof Error ? error.message : "Unknown Supabase error");
  const code = err?.code ?? "";
  const details = err?.details ?? "";
  const hint = err?.hint ?? "";
  const status = err?.status ?? "";
  const lowered = rawMessage.toLowerCase();

  if (source === "events" && (lowered.includes("column") && (lowered.includes("date_time") || lowered.includes("event_date")))) {
    return {
      tone: "error" as const,
      message: "The events table schema does not match the app query.",
      details: [
        `Source: public.${source}`,
        `Supabase message: ${rawMessage}`,
        `Code: ${code || "n/a"}`,
        `Status: ${status || "n/a"}`,
        details ? `Details: ${details}` : "",
        hint ? `Hint: ${hint}` : "",
        "Likely cause: the app is querying the unified `event_date` contract while the live database still exposes `date_time`, or vice versa.",
        "Next step: update the loader to use the existing column or add the missing compatibility column in Supabase.",
      ].filter(Boolean).join("\n"),
      hint: "Use the existing event date column in the query, or add the missing compatibility column in the events table.",
    };
  }

  if (source === "users") {
    let message = "The users table could not be loaded.";
    let nextAction = "Inspect the users table and its access rules.";

    if (code === "42501" || lowered.includes("permission denied") || lowered.includes("row-level security") || lowered.includes("rls")) {
      message = "The users table is blocked by row-level security.";
      nextAction = "Allow read access for anon/authenticated on public.users or switch to a server-side query path.";
    } else if (lowered.includes("relation") && lowered.includes("users")) {
      message = "The users table could not be found in the connected Supabase project.";
      nextAction = "Create or restore the public.users table in the selected database.";
    } else if (lowered.includes("column") && (lowered.includes("first_name") || lowered.includes("last_name") || lowered.includes("student_id") || lowered.includes("password"))) {
      message = "The users table is missing one or more required columns.";
      nextAction = "Add the missing columns used by the app, such as student_id, first_name, last_name, and password.";
    } else if (lowered.includes("jwt") || lowered.includes("api key") || lowered.includes("unauthorized") || lowered.includes("invalid token") || lowered.includes("no suitable key")) {
      message = "The Supabase credentials are not valid for this request.";
      nextAction = "Verify the Supabase URL and anon key in the environment configuration.";
    } else if (lowered.includes("not found") && lowered.includes("schema")) {
      message = "The users table is not available in the schema being queried.";
      nextAction = "Confirm that the request is targeting the correct Supabase project and schema.";
    } else if (lowered.includes("network") || lowered.includes("fetch failed") || lowered.includes("timeout")) {
      message = "The request could not reach Supabase successfully.";
      nextAction = "Check the network connection and confirm the Supabase endpoint is reachable.";
    }

    return {
      tone: "error" as const,
      message,
      details: [
        `Source: public.${source}`,
        `Supabase message: ${rawMessage}`,
        code ? `Code: ${code}` : "",
        status ? `Status: ${status}` : "",
        details ? `Details: ${details}` : "",
        hint ? `Hint: ${hint}` : "",
        `Next step: ${nextAction}`,
      ].filter(Boolean).join("\n"),
      hint: nextAction,
    };
  }

  return getAnnouncementErrorFeedback(error, "load");
};

const getProfileErrorFeedback = (error: unknown): FeedbackState => {
  const err = error as Record<string, any> | undefined;
  const rawMessage = err?.message ?? (error instanceof Error ? error.message : "Unknown Supabase error");
  const code = err?.code ?? "";
  const details = err?.details ?? "";
  const hint = err?.hint ?? "";
  const status = err?.status ?? "";
  const lowered = rawMessage.toLowerCase();

  let message = "Profile update failed.";
  let nextAction = "Inspect the Supabase RPC/update response and the users table permissions.";

  if (code === "42501" || lowered.includes("permission denied") || lowered.includes("row-level security") || lowered.includes("rls")) {
    message = "Profile update is blocked by table permissions.";
    nextAction = "Allow the authenticated role to update public.users or use a server-side update endpoint.";
  } else if (lowered.includes("function") && lowered.includes("update_user_profile")) {
    message = "The profile update RPC function is missing or not callable.";
    nextAction = "Create or re-run the public.update_user_profile SQL function and grant EXECUTE to authenticated.";
  } else if (lowered.includes("relation") && lowered.includes("users")) {
    message = "The users table could not be found in the connected Supabase project.";
    nextAction = "Create or restore the public.users table in the selected database before retrying.";
  } else if (lowered.includes("column") && (lowered.includes("first_name") || lowered.includes("last_name") || lowered.includes("password"))) {
    message = "The users table is missing one or more profile columns.";
    nextAction = "Add or rename the missing columns used by the profile form, such as first_name, last_name, and password.";
  } else if (lowered.includes("jwt") || lowered.includes("api key") || lowered.includes("unauthorized") || lowered.includes("invalid token") || lowered.includes("no suitable key")) {
    message = "The Supabase credentials are not usable for this request.";
    nextAction = "Verify the VITE Supabase URL and anon key in the environment configuration.";
  } else if (lowered.includes("network") || lowered.includes("fetch failed") || lowered.includes("timeout")) {
    message = "The profile update request could not reach Supabase successfully.";
    nextAction = "Check the network connection and confirm the Supabase endpoint is reachable.";
  }

  const diagnosticParts = [
    `Supabase message: ${rawMessage}`,
    code ? `Code: ${code}` : "",
    status ? `Status: ${status}` : "",
    details ? `Details: ${details}` : "",
    hint ? `Hint: ${hint}` : "",
    `Next step: ${nextAction}`,
  ].filter(Boolean);

  return {
    tone: "error",
    message,
    details: diagnosticParts.join("\n"),
    hint: nextAction,
  };
};

const getLoginErrorFeedback = (error: unknown, context: string): FeedbackState => {
  const err = error as Record<string, any> | undefined;
  const rawMessage = err?.message ?? (error instanceof Error ? error.message : "Unknown Supabase error");
  const code = err?.code ?? "";
  const details = err?.details ?? "";
  const hint = err?.hint ?? "";
  const status = err?.status ?? "";
  const lowered = rawMessage.toLowerCase();

  let message = `${context} failed.`;
  let nextAction = "Inspect the Supabase query, table schema, and access permissions.";

  if (code === "42501" || lowered.includes("permission denied") || lowered.includes("row-level security") || lowered.includes("rls")) {
    message = `${context} is blocked by table permissions.`;
    nextAction = "Allow the anon/authenticated role to query public.users or use a server-side path for authentication.";
  } else if (lowered.includes("function") && lowered.includes("check_login")) {
    message = "The login RPC function is missing or not callable.";
    nextAction = "Create or re-run the public.check_login SQL function and grant EXECUTE to anon/authenticated.";
  } else if (lowered.includes("relation") && lowered.includes("users")) {
    message = "The users table could not be found in the connected Supabase project.";
    nextAction = "Create or restore the public.users table in the selected database before retrying.";
  } else if (lowered.includes("column") && (lowered.includes("student_id") || lowered.includes("username") || lowered.includes("email") || lowered.includes("first_name") || lowered.includes("last_name") || lowered.includes("password"))) {
    message = "The users table is missing one or more login-related columns.";
    nextAction = "Add or rename the missing columns used for authentication, such as student_id, username, email, first_name, last_name, and password.";
  } else if (lowered.includes("jwt") || lowered.includes("api key") || lowered.includes("unauthorized") || lowered.includes("invalid token") || lowered.includes("no suitable key")) {
    message = "The Supabase credentials are not usable for this request.";
    nextAction = "Verify the VITE Supabase URL and anon key in the environment configuration.";
  } else if (lowered.includes("network") || lowered.includes("fetch failed") || lowered.includes("timeout")) {
    message = "The login request could not reach Supabase successfully.";
    nextAction = "Check the network connection and confirm the Supabase endpoint is reachable.";
  }

  const diagnosticParts = [
    `Context: ${context}`,
    `Supabase message: ${rawMessage}`,
    code ? `Code: ${code}` : "",
    status ? `Status: ${status}` : "",
    details ? `Details: ${details}` : "",
    hint ? `Hint: ${hint}` : "",
    `Next step: ${nextAction}`,
  ].filter(Boolean);

  return {
    tone: "error",
    message,
    details: diagnosticParts.join("\n"),
    hint: nextAction,
  };
};

const getUserByIdentifier = async (username: string, birthdatePassword: string) => {
  const attempts: Array<{ column: string; status: "found" | "empty" | "error"; error?: unknown }> = [];

  try {
    const usersRes = await supabase
      .from("users")
      .select("id, email, username, first_name, last_name, password_hash, birthdate_password, role_id, roles!users_role_id_fkey(name)")
      .eq("username", username)
      .maybeSingle();

    if (usersRes.error) {
      attempts.push({ column: "users.username", status: "error", error: usersRes.error });
      const firstError = attempts.find((attempt) => attempt.status === "error");
      return { user: null, attempts, error: firstError?.error ?? null };
    }

    if (!usersRes.data) {
      attempts.push({ column: "users.username", status: "empty" });
      return { user: null, attempts, error: null };
    }

    const match = String(usersRes.data.birthdate_password ?? "").trim() === String(birthdatePassword).trim();
    attempts.push({ column: "users.username", status: "found" });

    if (!match) {
      return { user: mapUser(usersRes.data), attempts, passwordMismatch: true };
    }

    return { user: mapUser(usersRes.data), attempts, passwordMismatch: false };
  } catch (err) {
    attempts.push({ column: "unknown", status: "error", error: err });
    return { user: null, attempts, error: err };
  }
};

function App() {
  const [authUser, setAuthUser] = useState<UserRecord | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [studentIdNumbers, setStudentIdNumbers] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [allEventAttendance, setAllEventAttendance] = useState<EventAttendanceRecord[]>([]);
  const [eventAttendance, setEventAttendance] = useState<Record<string, EventAttendanceRecord>>({});
  const [excusedEventIds, setExcusedEventIds] = useState<Set<string>>(new Set());
  const [announcements, setAnnouncements] = useState<AnnouncementRecord[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [fines, setFines] = useState<FineSettings>({ late: 0, absent: 0, wrongAttire: 0 });
  const [liquidations, setLiquidations] = useState<LiquidationRecord[]>([]);
  const [activeSection, setActiveSection] = useState<Section>("dashboard");
  const [loading, setLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [moneyFilter, setMoneyFilter] = useState<"all" | PaymentType>("all");
  const [moneyDateFrom, setMoneyDateFrom] = useState("");
  const [moneyDateTo, setMoneyDateTo] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginDebugDetails, setLoginDebugDetails] = useState("");
  const [announcementForm, setAnnouncementForm] = useState({ title: "", content: "" });
  const [announcementImage, setAnnouncementImage] = useState<File | null>(null);
  const [announcementImagePreview, setAnnouncementImagePreview] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [profileSavedAt, setProfileSavedAt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [announcementPreview, setAnnouncementPreview] = useState<null | { title: string; content: string; imageUrl?: string | null }>(null);
  const [fullSizeImage, setFullSizeImage] = useState<{ url: string; alt: string } | null>(null);
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | null>(null);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [excuseDrafts, setExcuseDrafts] = useState<Record<string, { reason: string; excuseLetter: string; letterFile: File | null; signedPhoto: File | null; open: boolean }>>({});
  const [submittedExcuses, setSubmittedExcuses] = useState<Record<string, ExcuseRequestRecord>>({});

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const refreshCurrentTime = () => setCurrentTime(Date.now());
    const intervalId = window.setInterval(refreshCurrentTime, 60_000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!authUser) return;

    const refreshSystem = () => setRefreshNonce((current) => current + 1);
    const realtimeTables = [
      "users",
      "students",
      "events",
      "event_attendance",
      "event_excused_students",
      "announcements",
      "collections",
      "student_payments",
      "transactions",
      "fines",
      "violation_ledger",
      "liquidations",
      "excuse_requests",
    ];
    const channel = supabase.channel(`student-portal-${authUser.id}-${Date.now()}`);

    realtimeTables.forEach((table) => {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        refreshSystem,
      );
    });

    channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn(`Supabase realtime unavailable for ${status}; polling fallback remains active.`);
      }
    });

    const intervalId = window.setInterval(refreshSystem, 30_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshSystem();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void supabase.removeChannel(channel);
    };
  }, [authUser]);

  useEffect(() => {
    const loadLiquidations = async () => {
      try {
        const { data, error } = await supabase
          .from("liquidations")
          .select("id, budget_request_id, actual_amount_spent, proof_filenames, remarks, submitted_by, date_submitted, status, reviewed_by, date_reviewed, is_final, rejection_reason")
          .order("date_submitted", { ascending: false })
          .limit(6);

        if (error) {
          const message = error.message ?? "Unknown Supabase error";
          console.error("Liquidations query failed", error);
          setFeedback({ tone: "error", message: `Liquidations access failed: ${message}` });
          setLiquidations([]);
          return;
        }

        setLiquidations((data ?? []) as LiquidationRecord[]);
      } catch (error) {
        console.error("Failed to load liquidations from Supabase", error);
        setFeedback({ tone: "error", message: "Unable to load liquidation records from the unified Supabase project." });
        setLiquidations([]);
      }
    };

    void loadLiquidations();
  }, [refreshNonce]);

  useEffect(() => {
    if (!authUser) return;

    const loadData = async () => {
      setLoading(true);
      setFeedback(null);
      try {
        const studentAttendancePromise = resolveStudentIdForUser(authUser).then(async (studentId) => {
          if (!studentId) {
            return {
              attendanceRes: { data: [], error: null },
              excusedRes: { data: [], error: null },
            };
          }

          const [attendanceRes, excusedRes] = await Promise.all([
            supabase
              .from("event_attendance")
              .select("id, event_id, student_id, time_in, time_out, status, calculated_fine, created_at")
              .eq("student_id", studentId),
            supabase
              .from("event_excused_students")
              .select("event_id")
              .eq("student_id", studentId)
              .is("revoked_at", null),
          ]);

          return { attendanceRes, excusedRes };
        });

        const [usersRes, studentsRes, eventsRes, announcementsRes, studentAttendanceRes, allAttendanceRes, allExcusedRes] = await Promise.all([
          supabase.from("users").select("id, email, username, first_name, last_name, password_hash, birthdate_password, role_id, roles!users_role_id_fkey(name)").order("first_name", { ascending: true }),
          supabase.from("students").select("id, student_IDnumber, first_name, last_name, email").order("last_name", { ascending: true }),
          loadEventsFromSupabase(),
          supabase.from("announcements").select("id,title,message,created_by,created_at,updated_at,deleted_at,type,priority,is_pinned,publish_date,expiry_date,image_url").order("publish_date", { ascending: false }),
          studentAttendancePromise,
          supabase.from("event_attendance").select("id, event_id, student_id, time_in, time_out, status, calculated_fine, calculated_cs_hours, created_at"),
          supabase.from("event_excused_students").select("event_id, student_id, revoked_at").is("revoked_at", null),
        ]);

        const { attendanceRes: eventAttendanceRes, excusedRes } = studentAttendanceRes;

        if (announcementsRes.error) {
          const announcementFeedback = getAnnouncementErrorFeedback(announcementsRes.error, "load");
          console.error("Announcements load failed", announcementFeedback);
          setFeedback(announcementFeedback);
          setAnnouncements([]);
          setLoading(false);
          return;
        }

        if (eventsRes.error) {
          const eventsFeedback = getDataLoadErrorFeedback(eventsRes.error, "events");
          console.error("Events load failed", eventsFeedback);
          setFeedback(eventsFeedback);
          setEvents([]);
          setLoading(false);
          return;
        }

        const loadErrors = [{ name: "users", error: usersRes.error }].filter((entry) => entry.error);

        const firstUserError = loadErrors.find((entry) => entry.name === "users")?.error;
        if (firstUserError) {
          const userFeedback = getDataLoadErrorFeedback(firstUserError, "users");
          console.error("Users load failed", userFeedback);
          setFeedback(userFeedback);
          setUsers([]);
          setLoading(false);
          return;
        }

        if (eventAttendanceRes.error) {
          console.warn("Event attendance load failed; events will show no attendance data", eventAttendanceRes.error);
        }

        if (excusedRes.error) {
          console.warn("Excused student records load failed; events will use attendance data only", excusedRes.error);
        }

        const visibleUsers = Array.isArray(usersRes.data) ? usersRes.data : [];
        if (!usersRes.error && visibleUsers.length === 0) {
          const emptyUsersFeedback = {
            tone: "error" as const,
            message: "The users table returned no visible rows.",
            details: [
              "Source: public.users",
              "Supabase returned an empty result set without raising an error.",
              "This usually means the current role cannot read the table, the selected schema/project is different, or the table is not exposed to the app’s anon/authenticated role.",
              "Next step: confirm the public.users read policy and verify that the connected Supabase project contains the rows you expect.",
            ].join("\n"),
            hint: "Allow read access for anon/authenticated on public.users or switch to a server-side query path.",
          };
          console.warn("Users load returned empty data without error", {
            status: usersRes.status,
            data: usersRes.data,
            count: usersRes.count,
          });
          setFeedback(emptyUsersFeedback);
          setUsers([]);
          setLoading(false);
          return;
        }

        console.debug("Announcements rows returned", Array.isArray(announcementsRes.data) ? announcementsRes.data.length : 0, announcementsRes.data);

        const visibleEvents = (eventsRes.data ?? []).map(mapEvent);
        const activeExcusedEventIds = new Set(
          (excusedRes.data ?? []).map((row: Record<string, any>) => String(row.event_id)),
        );
        const attendancePayments = (eventAttendanceRes.data ?? [])
          .map((row) => mapEventAttendance(row as Record<string, any>))
          .filter((attendance) => !activeExcusedEventIds.has(attendance.eventId))
          .map((attendance) => {
            const event = visibleEvents.find((candidate) => candidate.id === attendance.eventId);
            return {
              id: `attendance-fine-${attendance.id}`,
              userId: attendance.studentId,
              title: event?.title ?? "Unknown event",
              type: "Fine" as const,
              amount: getAttendanceFine(attendance),
              status: "pending" as const,
              eventId: attendance.eventId,
              paymentDate: attendance.createdAt ?? event?.dateTime,
              remarks: "Fine report from event attendance",
              ledgerKind: "fine" as const,
            } satisfies Payment;
          })
          .sort((a, b) => {
            const aTime = a.paymentDate ? new Date(a.paymentDate).getTime() : 0;
            const bTime = b.paymentDate ? new Date(b.paymentDate).getTime() : 0;
            return bTime - aTime;
          });

        const mappedStudentIds = (studentsRes.data ?? []).reduce<Record<string, string>>((accumulator, row: Record<string, any>) => {
          const studentId = String(row.id ?? "");
          const studentNumber = String(row.student_IDnumber ?? "").trim();
          if (studentId && studentNumber) accumulator[studentId] = studentNumber;
          return accumulator;
        }, {});

        const excusedStudentEventKeys = new Set(
          (allExcusedRes.data ?? []).map((row: Record<string, any>) => `${String(row.student_id ?? "")}:${String(row.event_id ?? "")}`),
        );

        const sanitizedAllAttendance = (allAttendanceRes.data ?? [])
          .filter((row: Record<string, any>) => !excusedStudentEventKeys.has(`${String(row.student_id ?? "")}:${String(row.event_id ?? "")}`));

        setUsers(visibleUsers.map(mapUser));
        setStudentIdNumbers(mappedStudentIds);
        setEvents(visibleEvents);
        setAllEventAttendance(sanitizedAllAttendance.map((row) => mapEventAttendance(row as Record<string, any>)));
        setExcusedEventIds(activeExcusedEventIds);
        setEventAttendance(
          (eventAttendanceRes.data ?? []).reduce<Record<string, EventAttendanceRecord>>((attendanceByEvent, row) => {
            const attendance = mapEventAttendance(row as Record<string, any>);
            if (attendance.eventId) attendanceByEvent[attendance.eventId] = attendance;
            return attendanceByEvent;
          }, {})
        );
        setAnnouncements((announcementsRes.data ?? []).filter((row: Record<string, any>) => !row.deleted_at).map(mapAnnouncement));
        setPayments(attendancePayments);
      } catch (error) {
        console.error("Announcement data load failed", error);
        const announcementFeedback = getAnnouncementErrorFeedback(error, "load");
        setFeedback(announcementFeedback);
      } finally {
        setLoading(false);
      }
    };

    void loadData();
  }, [authUser, refreshNonce]);

  const fmtAttendanceTime = (value: string | null) =>
    value
      ? new Date(value).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })
      : "Not recorded";

  useEffect(() => {
    if (!authUser) {
      setSubmittedExcuses({});
      return;
    }

    const loadSubmittedExcuses = async () => {
      try {
        const { data, error } = await supabase
          .from("excuse_requests")
          .select("id, attendance_id, requested_by, reviewed_by, status, approval_action, reason, decision_notes, supporting_document, supporting_document_name, supporting_document_mime, excuse_letter, excuse_letter_name, excuse_letter_mime, created_at, decided_at")
          .eq("requested_by", authUser.id)
          .order("created_at", { ascending: false });

        if (error) throw error;

        const nextSubmittedExcuses = (data ?? []).reduce<Record<string, ExcuseRequestRecord>>((accumulator, row) => {
          const mapped = mapExcuseRequest(row as Record<string, any>);
          if (mapped.eventId) {
            accumulator[mapped.eventId] = mapped;
          }
          return accumulator;
        }, {});

        setSubmittedExcuses(nextSubmittedExcuses);
      } catch (error) {
        console.error("Failed to load excuse requests for current user", error);
        setSubmittedExcuses({});
      }
    };

    void loadSubmittedExcuses();
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;

    const liveUser = users.find((user) => user.id === authUser.id);
    const firstName = liveUser?.firstName ?? authUser.firstName;
    const lastName = liveUser?.lastName ?? authUser.lastName;
    const email = liveUser?.email ?? authUser.email;

    setProfileForm({
      firstName,
      lastName,
      email,
      password: authUser.password ?? "",
    });
  }, [authUser, users]);

  const orderedEvents = useMemo(() => {
    const today = startOfToday();

    return [...events].sort((a, b) => {
      const aTime = parseEventDate(a.dateTime).getTime();
      const bTime = parseEventDate(b.dateTime).getTime();
      const aIsUpcoming = aTime >= today;
      const bIsUpcoming = bTime >= today;

      if (aIsUpcoming !== bIsUpcoming) {
        return aIsUpcoming ? -1 : 1;
      }

      if (aIsUpcoming && bIsUpcoming) {
        return aTime - bTime;
      }

      return bTime - aTime;
    });
  }, [currentTime, events]);

  const pendingAmount = useMemo(() => payments.filter((item) => item.status === "pending").reduce((sum, item) => sum + item.amount, 0), [payments]);
  const nextEvent = orderedEvents.find((event) => parseEventDate(event.dateTime).getTime() >= startOfToday());
  const latestAnnouncement = useMemo(() => [...announcements].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0], [announcements]);
  const filteredPayments = useMemo(() => {
    const fromDate = moneyDateFrom ? new Date(`${moneyDateFrom}T00:00:00`) : null;
    const toDate = moneyDateTo ? new Date(`${moneyDateTo}T23:59:59`) : null;
    return payments.filter((payment) => {
      const typeMatch = moneyFilter === "all" || payment.type === moneyFilter;
      const paymentDate = payment.paymentDate ? new Date(payment.paymentDate) : null;
      const dateMatch = (!fromDate || (paymentDate && paymentDate >= fromDate)) && (!toDate || (paymentDate && paymentDate <= toDate));

      return typeMatch && dateMatch;
    });
  }, [moneyDateFrom, moneyDateTo, moneyFilter, payments]);
  const rankings = useMemo(() => {
    const eventMap = new Map(events.map((event) => [event.id, event]));
    const entries = new Map<string, {
      studentId: string;
      fines: number;
      hours: number;
      earlyBirds: number;
      earlyMinutesTotal: number;
      lateBirds: number;
      lateMinutesTotal: number;
    }>();

    allEventAttendance.forEach((attendance) => {
      const studentId = attendance.studentId;
      if (!studentId) return;

      const displayStudentId = studentIdNumbers[studentId] ?? users.find((user) => user.id === studentId)?.studentId ?? studentId;

      const entry = entries.get(studentId) ?? {
        studentId: displayStudentId,
        fines: 0,
        hours: 0,
        earlyBirds: 0,
        earlyMinutesTotal: 0,
        lateBirds: 0,
        lateMinutesTotal: 0,
      };

      entry.studentId = displayStudentId;
      entry.fines += Number(attendance.calculatedFine ?? 0);
      entry.hours += Number(attendance.calculatedCsHours ?? 0);

      const currentEvent = eventMap.get(attendance.eventId);
      const timeIn = attendance.timeIn ? new Date(attendance.timeIn) : null;
      const scheduledTimeIn = currentEvent?.requiredTimeIn && currentEvent.dateTime
        ? new Date(`${parseEventDate(currentEvent.dateTime).toISOString().slice(0, 10)}T${currentEvent.requiredTimeIn}`)
        : null;

      if (scheduledTimeIn && timeIn && timeIn < scheduledTimeIn) {
        const minutesEarly = (scheduledTimeIn.getTime() - timeIn.getTime()) / 60000;
        entry.earlyBirds += 1;
        entry.earlyMinutesTotal += minutesEarly;
      }

      if (scheduledTimeIn && timeIn && timeIn > scheduledTimeIn) {
        const thresholdMinutes = Number(currentEvent?.lateThresholdMinutes ?? 15);
        const latenessAfterThreshold = Math.max(0, (timeIn.getTime() - scheduledTimeIn.getTime()) / 60000 - thresholdMinutes);
        if (latenessAfterThreshold > 0) {
          entry.lateBirds += 1;
          entry.lateMinutesTotal += latenessAfterThreshold;
        }
      }

      if (attendance.status.toLowerCase().includes("late") && !scheduledTimeIn) {
        entry.lateBirds += 1;
      }

      entries.set(studentId, entry);
    });

    return {
      fines: [...entries.values()].sort((a, b) => b.fines - a.fines).slice(0, 5),
      hours: [...entries.values()].sort((a, b) => b.hours - a.hours).slice(0, 5),
      early: [...entries.values()].sort((a, b) => b.earlyBirds - a.earlyBirds).slice(0, 5),
      late: [...entries.values()].sort((a, b) => b.lateMinutesTotal - a.lateMinutesTotal).slice(0, 5),
    };
  }, [allEventAttendance, events, studentIdNumbers, users]);
  const isStudentRole = String(authUser?.roleName ?? authUser?.role ?? "").trim().toLowerCase() === "student";
  const canManageAnnouncements = authUser?.source === "users" && !isStudentRole;

  const parseRpcRow = (data: unknown) => {
    if (!data) return null;
    if (Array.isArray(data)) return data[0] ?? null;
    if (typeof data === "object") return data;
    return null;
  };

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoginError("");
    setLoginDebugDetails("");
    setLoading(true);

    try {
      const trimmedUsername = email.trim();
      const trimmedBirthdatePassword = password.trim();

      if (!trimmedUsername || !trimmedBirthdatePassword) {
        setLoginError("Please enter your username and birthdate password.");
        setLoginDebugDetails("The login form was submitted with an empty username or birthdate_password value.");
        return;
      }

      let loginRow = null;
      let rpcError: unknown = null;

      const tryRpc = async (payload: Record<string, string>) => {
        const { data, error } = await supabase.rpc("check_login", payload as any);
        if (!error) {
          return parseRpcRow(data);
        }
        rpcError = error;
        return null;
      };

      loginRow = await tryRpc({ p_identifier: trimmedUsername, p_password: trimmedBirthdatePassword });

      if (loginRow) {
        const row = loginRow as { id: string; username?: string; student_id?: string; first_name: string; last_name: string; role?: string; email?: string };
        const { roleName, role } = getRoleDetails(row as Record<string, any>);
        setAuthUser({
          id: row.id,
          email: row.email ?? "",
          username: row.username ?? row.email ?? "",
          studentId: row.student_IDnumber ?? row.username ?? row.student_id ?? row.email ?? "",
          firstName: row.first_name,
          lastName: row.last_name,
          password: trimmedBirthdatePassword,
          role,
          roleName,
          source: "users",
        });
        return;
      }

      if (rpcError) {
        const rpcFeedback = getLoginErrorFeedback(rpcError, "RPC check_login");
        console.error("Login RPC failed", rpcFeedback);
        setLoginDebugDetails(rpcFeedback.details ?? rpcFeedback.message);
      }

      const fallbackResult = await getUserByIdentifier(trimmedUsername, trimmedBirthdatePassword);
      if (fallbackResult.error) {
        const fallbackFeedback = getLoginErrorFeedback(fallbackResult.error, "Fallback users lookup");
        console.error("Login fallback lookup failed", fallbackFeedback);
        setLoginDebugDetails(fallbackFeedback.details ?? fallbackFeedback.message);
      }

      const dbUser = fallbackResult.user;
      if (dbUser && !fallbackResult.passwordMismatch) {
        setAuthUser({
          ...dbUser,
          username: dbUser.username || trimmedUsername,
          studentId: dbUser.username || dbUser.studentId || trimmedUsername,
          password: trimmedBirthdatePassword,
        });
        return;
      }

      if (!fallbackResult.user) {
        setLoginError("No matching account was found for that username.");
        setLoginDebugDetails(
          fallbackResult.error
            ? "The app tried to read the users table with the current credential shape, but the live Supabase project did not answer that shape successfully. Confirm the connected project’s columns, RLS policies, and RPC availability before retrying."
            : "The app checked the users table, but no matching username was returned for the supplied credentials."
        );
        return;
      }

      setLoginError("Invalid credentials. Please check your username and birthdate password and try again.");
      setLoginDebugDetails("The supplied username matched a user record, but the birthdate_password value did not match the value in the users table.");
    } catch (error) {
      const diagnostic = getLoginErrorFeedback(error, "Login request");
      console.error("Login failed", diagnostic);
      setLoginError(diagnostic.message);
      setLoginDebugDetails(diagnostic.details ?? diagnostic.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setAuthUser(null);
    setEmail("");
    setPassword("");
    setActiveSection("dashboard");
    setFeedback(null);
    setShowSignOutConfirm(false);
  };

  const handleCreateAnnouncement = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!authUser || !announcementPreview) return;

    if (String(authUser.roleName ?? authUser.role ?? "").toLowerCase().includes("student")) {
      setFeedback({
        tone: "error",
        message: "Students cannot create announcements.",
        hint: "Only users whose role in the roles table is not Student can post announcements.",
      });
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    let uploadedImagePath: string | null = null;
    try {
      let uploadedImageUrl: string | null = null;

      if (announcementImage) {
        const uploadedImage = await uploadAnnouncementImage(announcementImage, authUser.id);
        uploadedImageUrl = uploadedImage.publicUrl;
        uploadedImagePath = uploadedImage.path;
      } else if (editingAnnouncementId) {
        uploadedImageUrl = announcements.find((item) => item.id === editingAnnouncementId)?.imageUrl ?? null;
      }

      if (editingAnnouncementId) {
        const { data, error } = await supabase
          .from("announcements")
          .update({
            title: announcementPreview.title,
            message: announcementPreview.content,
            image_url: uploadedImageUrl,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingAnnouncementId)
          .select("*")
          .single();

        if (error) throw error;

        setAnnouncements((current) => current.map((item) => (item.id === editingAnnouncementId ? mapAnnouncement(data) : item)));
        setFeedback({ tone: "success", message: "Announcement updated in Database." });
      } else {
        const basePayload = {
          title: announcementPreview.title,
          message: announcementPreview.content,
          image_url: uploadedImageUrl,
          type: "info",
          priority: "normal",
          is_pinned: false,
          publish_date: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };

        let data: Record<string, any> | null = null;
        let error: Error | null = null;

        const tryInsert = async (payload: Record<string, unknown>) => {
          const result = await supabase.from("announcements").insert(payload).select("*").single();
          return result;
        };

        const unifiedPayload = { ...basePayload, created_by: authUser.id };

        const firstAttempt = await tryInsert(unifiedPayload);
        data = firstAttempt.data;
        error = firstAttempt.error as Error | null;

        if (error) throw error;
        if (!data) throw new Error("No announcement row was returned from Supabase.");

        setAnnouncements((current) => [mapAnnouncement(data), ...current]);
        setFeedback({ tone: "success", message: "Announcement posted to Supabase." });
      }

      setAnnouncementForm({ title: "", content: "" });
      setAnnouncementImage(null);
      setAnnouncementImagePreview(null);
      setAnnouncementPreview(null);
      setEditingAnnouncementId(null);
    } catch (error) {
      if (uploadedImagePath) {
        await supabase.storage.from(ANNOUNCEMENT_IMAGE_BUCKET).remove([uploadedImagePath]);
      }
      console.error("Announcement write failed", error);
      setFeedback(getAnnouncementErrorFeedback(error, editingAnnouncementId ? "update" : "create"));
    } finally {
      setSubmitting(false);
    }
  };

  const requestAnnouncementConfirmation = (event: FormEvent) => {
    event.preventDefault();

    if (String(authUser?.roleName ?? authUser?.role ?? "").toLowerCase().includes("student")) {
      setFeedback({
        tone: "error",
        message: "Students cannot create announcements.",
        hint: "Use the roles table name for the logged-in user. If it resolves to Student, this action is blocked.",
      });
      return;
    }

    setAnnouncementPreview({
      title: announcementForm.title,
      content: announcementForm.content,
      imageUrl: announcementImagePreview,
    });
  };

  const handleEditAnnouncement = (announcement: AnnouncementRecord) => {
    if (String(authUser?.roleName ?? authUser?.role ?? "").toLowerCase().includes("student")) {
      setFeedback({
        tone: "error",
        message: "Students cannot edit announcements.",
      });
      return;
    }

    setEditingAnnouncementId(announcement.id);
    setAnnouncementForm({ title: announcement.title, content: announcement.content });
    setAnnouncementImage(null);
    setAnnouncementImagePreview(announcement.imageUrl ?? null);
    setAnnouncementPreview(null);
  };

  const handleDeleteAnnouncement = async (announcementId: string) => {
    if (String(authUser?.roleName ?? authUser?.role ?? "").toLowerCase().includes("student")) {
      setFeedback({
        tone: "error",
        message: "Students cannot delete announcements.",
      });
      return;
    }

    if (!window.confirm("Delete this announcement?")) return;

    setSubmitting(true);
    setFeedback(null);

    try {
      const { error } = await supabase
        .from("announcements")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", announcementId);
      if (error) throw error;
      setAnnouncements((current) => current.filter((item) => item.id !== announcementId));
      setFeedback({ tone: "success", message: "Announcement deleted." });
    } catch (error) {
      console.error("Announcement delete failed", error);
      setFeedback(getAnnouncementErrorFeedback(error, "delete"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitExcuseLetter = async (event: EventRecord) => {
    if (!authUser) return;

    const draft = excuseDrafts[event.id] ?? { reason: "", excuseLetter: "", letterFile: null, signedPhoto: null, open: false };
    const trimmedReason = draft.reason.trim();

    if (!draft.letterFile || !draft.signedPhoto) {
      setFeedback({
        tone: "error",
        message: "Please upload both required files before submitting.",
        hint: "Upload the soft copy of your excuse letter and a photo of the letter signed by your guardian.",
      });
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    let uploadedPaths: string[] = [];
    try {
      const letterUpload = await uploadExcuseRequestFile(draft.letterFile, authUser.id, "letter");
      uploadedPaths.push(letterUpload.path);
      const signedPhotoUpload = await uploadExcuseRequestFile(draft.signedPhoto, authUser.id, "signed-photo");
      uploadedPaths.push(signedPhotoUpload.path);

      const { data, error } = await supabase
        .from("excuse_requests")
        .insert({
          attendance_id: event.id,
          requested_by: authUser.id,
          approval_action: "excused",
          status: "pending",
          reason: trimmedReason || null,
          excuse_letter: letterUpload.path,
          excuse_letter_name: letterUpload.name,
          excuse_letter_mime: letterUpload.mime,
          supporting_document: signedPhotoUpload.path,
          supporting_document_name: signedPhotoUpload.name,
          supporting_document_mime: signedPhotoUpload.mime,
        })
        .select("id, attendance_id, requested_by, reviewed_by, status, approval_action, reason, decision_notes, supporting_document, supporting_document_name, supporting_document_mime, excuse_letter, excuse_letter_name, excuse_letter_mime, created_at, decided_at")
        .single();

      if (error) throw error;

      const mappedRequest = mapExcuseRequest(data as Record<string, any>);

      setSubmittedExcuses((current) => ({
        ...current,
        [event.id]: mappedRequest,
      }));
      setExcuseDrafts((current) => ({
        ...current,
        [event.id]: { reason: "", excuseLetter: "", letterFile: null, signedPhoto: null, open: false },
      }));
      setFeedback({ tone: "success", message: "Excuse request submitted successfully." });
    } catch (error) {
      if (uploadedPaths.length > 0) {
        await supabase.storage.from(EXCUSE_REQUEST_BUCKET).remove(uploadedPaths);
      }
      const err = error as Record<string, any> | undefined;
      const rawMessage = err?.message ?? (error instanceof Error ? error.message : "Unknown Supabase error");
      console.error("Excuse request submission failed", error);
      setFeedback({
        tone: "error",
        message: "Excuse request could not be submitted.",
        details: rawMessage,
        hint: "Check that the public.excuse_requests table exists in the current Supabase project and that the current user can create records in it.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!authUser) return;

    const trimmedFirstName = profileForm.firstName.trim();
    const trimmedLastName = profileForm.lastName.trim();
    const trimmedEmail = profileForm.email.trim();
    const nextPassword = profileForm.password.trim();

    if (!trimmedEmail) {
      setFeedback({ tone: "error", message: "Email is required to save your profile." });
      return;
    }

    if (nextPassword && !window.confirm("Are you sure you want to change your password?")) {
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    try {
      let row: Record<string, any> | null = null;

      const rpcResult = await supabase.rpc("update_user_profile", {
        p_user_id: authUser.id,
        p_first_name: trimmedFirstName,
        p_last_name: trimmedLastName,
        p_new_password: nextPassword,
      });

      if (!rpcResult.error) {
        row = Array.isArray(rpcResult.data)
          ? rpcResult.data[0]
          : rpcResult.data && typeof rpcResult.data === "object"
          ? rpcResult.data
          : null;
      } else {
        const fallbackPassword = nextPassword ? await bcrypt.hash(nextPassword, 10) : undefined;
        const { data, error } = await supabase
          .from("users")
          .update({
            email: trimmedEmail,
            first_name: trimmedFirstName,
            last_name: trimmedLastName,
            ...(fallbackPassword ? { password_hash: fallbackPassword } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("id", authUser.id)
          .select("id, email, first_name, last_name, password_hash, role_id, roles!users_role_id_fkey(name)")
          .single();

        if (error) throw error;
        row = data;
      }

      if (!row) throw new Error("No profile row returned");

      const updatedUser = mapUser({
        ...row,
        email: trimmedEmail,
        first_name: row.first_name ?? trimmedFirstName,
        last_name: row.last_name ?? trimmedLastName,
      });

      if (trimmedEmail !== authUser.email) {
        const { data: emailRow, error: emailError } = await supabase
          .from("users")
          .update({ email: trimmedEmail, updated_at: new Date().toISOString() })
          .eq("id", authUser.id)
          .select("id, email")
          .single();

        if (emailError) throw emailError;
        updatedUser.email = emailRow?.email ?? trimmedEmail;
      }

      setAuthUser({
        ...updatedUser,
        password: nextPassword || authUser.password,
      });
      setUsers((current) => current.map((user) => (user.id === updatedUser.id ? updatedUser : user)));
      setProfileForm((prev) => ({ ...prev, firstName: trimmedFirstName, lastName: trimmedLastName, email: updatedUser.email, password: nextPassword || authUser.password }));
      setProfileSavedAt(new Date().toISOString());
      setFeedback({ tone: "success", message: "Profile updated in Supabase." });
    } catch (error) {
      const diagnostic = getProfileErrorFeedback(error);
      console.error("Profile update failed", diagnostic);
      setFeedback(diagnostic);
    } finally {
      setSubmitting(false);
    }
  };

  const mobileCards = navItems.filter((item) => item.id !== "dashboard").map((item) => ({
    ...item,
    summary: (() => {
      if (item.id === "profile") return `${authUser?.firstName ?? "Member"} ${authUser?.lastName ?? ""}`.trim();
      if (item.id === "events") return nextEvent ? `${events.length} records • ${fmtDateTime(nextEvent.dateTime)}` : "No live events yet";
      if (item.id === "announcements") return latestAnnouncement ? latestAnnouncement.title : "No posts yet";
      if (item.id === "money") return `${payments.filter((payment) => payment.status === "pending").length} pending • ${currency.format(pendingAmount)}`;
      if (item.id === "rankings") return `${users.length} active members`;
      return "Overview";
    })(),
  }));

  if (!authUser) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(248,113,113,0.16),_transparent_35%),linear-gradient(135deg,_#020617,_#0f172a_55%,_#111827)] text-slate-100">
        <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 py-8">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/80 p-6 shadow-2xl shadow-black/40 backdrop-blur">
            <div className="mb-6 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-slate-900/80">
                <img src="CITE Logo.jpg" alt="System Logo" className="h-10 w-10 object-contain" />
              </div>
            </div>
            <h2 className="mb-2 text-center text-2xl font-semibold text-white">College of Information Technology and Engineering Portal</h2>
            <form onSubmit={handleLogin} className="space-y-4">
              <label className="block text-sm text-slate-300">
                <span className="mb-2 block text-xs uppercase tracking-[0.3em] text-slate-500">ID Number</span>
                <input value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-3 text-sm text-slate-100 outline-none" placeholder="000-00-0000" required />
              </label>
              <label className="block text-sm text-slate-300">
                <span className="mb-2 block text-xs uppercase tracking-[0.3em] text-slate-500">Password</span>
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-3 text-sm text-slate-100 outline-none" placeholder="12-25-1982" required />
              </label>
              {loginError ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{loginError}</div> : null}
              {loginDebugDetails ? <div className="rounded-xl border border-slate-700/70 bg-slate-900/80 p-3 text-xs leading-5 text-slate-300"><div className="mb-1 font-semibold uppercase tracking-[0.2em] text-slate-400">Diagnostics</div><pre className="whitespace-pre-wrap font-sans">{loginDebugDetails}</pre></div> : null}
              <button type="submit" disabled={loading} className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-60">{loading ? "Signing in…" : "Sign in"}</button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top_left,_rgba(248,113,113,0.14),_transparent_32%),linear-gradient(135deg,_#020617,_#0f172a_55%,_#111827)] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col lg:flex-row">
        <aside className="hidden w-72 shrink-0 border-r border-white/10 bg-slate-950/80 px-5 py-6 lg:flex lg:flex-col">
          <div className="mb-6 flex items-center gap-3 border-b border-white/10 pb-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-slate-900/80">
              <img src="CITE Logo.jpg" alt="System Logo" className="h-8 w-8 object-contain" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-slate-400">STUDENT</p>
              <h1 className="text-base font-semibold text-white">Portal System</h1>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-600/20 text-sm font-semibold text-red-300">
                {authUser.firstName[0]}{authUser.lastName[0]}
              </div>
              <div>
                <p className="font-semibold text-white">{authUser.firstName} {authUser.lastName}</p>
                <p className="text-sm text-slate-400">{authUser.studentId}</p>
              </div>
            </div>
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${roleBadge(authUser.roleName ?? authUser.role)}`}>{roleLabel(authUser.roleName ?? authUser.role)}</span>
          </div>

          <nav className="mt-6 space-y-2">
            {navItems.map(({ id, label, icon: Icon }) => {
              const active = activeSection === id;
              return (
                <button key={id} onClick={() => setActiveSection(id)} className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-sm transition ${active ? "border-red-500/30 bg-red-600/15 text-white" : "border-transparent bg-transparent text-slate-400 hover:border-white/10 hover:bg-slate-900/70 hover:text-slate-200"}`}>
                  <span className="flex items-center gap-3"><Icon className="h-4 w-4" />{label}</span>
                  {active ? <ArrowRight className="h-4 w-4" /> : null}
                </button>
              );
            })}
          </nav>

        </aside>

        <div className="flex-1">
          <header className="border-b border-white/10 bg-slate-950/70 px-4 py-4 backdrop-blur lg:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-slate-900/80 lg:hidden">
                  <img src="CITE Logo.jpg" alt="System Logo" className="h-7 w-7 object-contain" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">{isMobile && activeSection === "dashboard" ? "Dashboard" : navItems.find((item) => item.id === activeSection)?.label}</h2>
                </div>
              </div>
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
              {navItems.map(({ id, label, icon: Icon }) => {
                const active = activeSection === id;
                return (
                  <button
                    key={id}
                    onClick={() => setActiveSection(id)}
                    className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-sm whitespace-nowrap ${active ? "border-red-500/30 bg-red-600/15 text-white" : "border-white/10 bg-slate-900/70 text-slate-300"}`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                );
              })}
            </div>
          </header>

          <main className="px-4 py-4 lg:px-6 lg:py-6">
            {feedback ? (
              <div className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${feedback.tone === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>
                <div className="font-medium">{feedback.message}</div>
                {feedback.details ? <pre className="mt-2 whitespace-pre-wrap text-xs opacity-90">{feedback.details}</pre> : null}
                {feedback.hint ? <p className="mt-2 text-xs opacity-80">{feedback.hint}</p> : null}
              </div>
            ) : null}

            {isMobile && activeSection === "dashboard" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {mobileCards.map((item) => (
                  <button key={item.id} onClick={() => setActiveSection(item.id)} className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 text-left shadow-lg shadow-black/20">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="rounded-xl border border-white/10 bg-slate-800/60 p-2"><item.icon className="h-4 w-4 text-red-300" /></span>
                      <span className="text-xs uppercase tracking-[0.3em] text-slate-500">tap</span>
                    </div>
                    <p className="text-sm font-semibold text-white">{item.label}</p>
                    <p className="mt-2 text-sm text-slate-400">{item.summary}</p>
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-xl shadow-black/20 lg:p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.35em] text-slate-500">{activeSection === "dashboard" ? "Overview" : navItems.find((item) => item.id === activeSection)?.label}</p>
                      <h3 className="text-xl font-semibold text-white">{activeSection === "dashboard" ? "System overview" : `Manage ${navItems.find((item) => item.id === activeSection)?.label}`}</h3>
                    </div>
                    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-800/70 px-3 py-2 text-sm text-slate-300"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> {loading ? "Syncing…" : "Synced"}</div>
                  </div>
                </section>

                {activeSection === "dashboard" ? (
                  <>
                    <div className={`grid gap-4 ${authUser.source === "students" ? "md:grid-cols-2 xl:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-3"}`}>
                      {authUser.source === "users" ? (
                        <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                          <p className="text-sm text-slate-400">Student Count:</p>
                          <p className="mt-2 text-3xl font-semibold text-white">{users.length}</p>
                        </div>
                      ) : null}
                      <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                        <p className="text-sm text-slate-400">Upcoming event</p>
                        <p className="mt-2 text-lg font-semibold text-white">{nextEvent ? nextEvent.title : "No events"}</p>
                        <p className="mt-2 text-sm text-slate-500">{nextEvent ? fmtDateTime(nextEvent.dateTime) : "No upcomming event/s."}</p>
                      </div>
                      <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                        <p className="text-sm text-slate-400">Your pending balance</p>
                        <p className="mt-2 text-3xl font-semibold text-white">{currency.format(pendingAmount)}</p>
                        <p className="mt-2 text-sm text-slate-500">Fines, Contributions, and Fees.</p>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm text-slate-400">Announcements</p>
                          <h4 className="mt-1 text-lg font-semibold text-white">Recent updates</h4>
                        </div>
                        <span className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-300">
                          {announcements.length} posts
                        </span>
                      </div>

                      <div className="mt-4 space-y-3">
                        {announcements.length === 0 ? (
                          <p className="text-sm text-slate-400">No announcements yet.</p>
                        ) : (
                          [...announcements]
                            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                            .slice(0, 3)
                            .map((item) => (
                              <div key={item.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-white">{item.title}</p>
                                    <p className="mt-2 line-clamp-3 text-sm text-slate-400">{item.content}</p>
                                  </div>
                                  {item.imageUrl ? (
                                    <button
                                      type="button"
                                      onClick={() => setFullSizeImage({ url: item.imageUrl ?? "", alt: item.title })}
                                      className="ml-2 shrink-0 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/80"
                                      aria-label={`View ${item.title} image full size`}
                                    >
                                      <img src={item.imageUrl} alt={item.title} className="h-14 w-14 object-cover" />
                                    </button>
                                  ) : null}
                                </div>
                                <p className="mt-3 text-xs text-slate-500">{fmtDateTime(item.createdAt)}</p>
                              </div>
                            ))
                        )}
                      </div>
                    </div>

                    <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm text-slate-400">Cashflow liquidations</p>
                          <h4 className="mt-1 text-lg font-semibold text-white">Latest liquidation entries</h4>
                        </div>
                        <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300">
                          {liquidations.length} records
                        </span>
                      </div>

                      <div className="mt-4 space-y-3">
                        {liquidations.length === 0 ? (
                          <p className="text-sm text-slate-400">No liquidation records were returned from the unified database.</p>
                        ) : (
                          liquidations.map((item) => (
                            <div key={item.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-semibold text-white">Request #{item.budget_request_id ?? "—"}</p>
                                <span className={`rounded-full px-2 py-1 text-xs ${item.is_final ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : item.status === "reviewed" ? "border border-cyan-500/20 bg-cyan-500/10 text-cyan-300" : "border border-amber-500/20 bg-amber-500/10 text-amber-300"}`}>
                                  {item.is_final ? "finalized" : item.status ?? "pending"}
                                </span>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-400">
                                <p>{item.remarks || "No remarks provided."}</p>
                                <p className="font-semibold text-white">{currency.format(Number(item.actual_amount_spent ?? 0))}</p>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                <span>{item.proof_filenames || "No proof files"}</span>
                                {item.rejection_reason ? <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-rose-300">{item.rejection_reason}</span> : null}
                              </div>
                              <p className="mt-2 text-xs text-slate-500">
                                {item.date_submitted ? fmtDateTime(item.date_submitted) : "No submission date"}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                ) : null}

                {activeSection === "profile" ? (
                  <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
                    <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                      <p className="text-sm uppercase tracking-[0.3em] text-slate-500">PROFILE</p>
                      <h4 className="mt-2 text-xl font-semibold text-white">{authUser.firstName} {authUser.lastName}</h4>
                      <p className="mt-2 text-sm text-slate-400">Student ID: {authUser.studentId}</p>
                      <div className={`mt-4 inline-flex rounded-full px-3 py-1 text-sm font-medium ${roleBadge(authUser.roleName ?? authUser.role)}`}>{roleLabel(authUser.roleName ?? authUser.role)}</div>
                    </div>
                    <form onSubmit={handleSaveProfile} className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="block text-sm text-slate-300">
                          <span className="mb-2 block text-xs uppercase tracking-[0.3em] text-slate-500">First name</span>
                          <input value={profileForm.firstName} onChange={(event) => setProfileForm({ ...profileForm, firstName: event.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-sm text-slate-100" />
                        </label>
                        <label className="block text-sm text-slate-300">
                          <span className="mb-2 block text-xs uppercase tracking-[0.3em] text-slate-500">Last name</span>
                          <input value={profileForm.lastName} onChange={(event) => setProfileForm({ ...profileForm, lastName: event.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-sm text-slate-100" />
                        </label>
                      </div>
                      <label className="mt-4 block text-sm text-slate-300">
                        <span className="mb-2 block text-xs uppercase tracking-[0.3em] text-slate-500">Email</span>
                        <input type="email" value={profileForm.email} onChange={(event) => setProfileForm({ ...profileForm, email: event.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-sm text-slate-100" required />
                      </label>
                      <label className="mt-4 block text-sm text-slate-300">
                        <span className="mb-2 block text-xs uppercase tracking-[0.3em] text-slate-500">Password</span>
                        <div className="flex gap-2">
                          <input type={showPassword ? "text" : "password"} value={profileForm.password} onChange={(event) => setProfileForm({ ...profileForm, password: event.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-sm text-slate-100" />
                          <button
                            type="button"
                            onMouseDown={() => setShowPassword(true)}
                            onMouseUp={() => setShowPassword(false)}
                            onMouseLeave={() => setShowPassword(false)}
                            onTouchStart={() => setShowPassword(true)}
                            onTouchEnd={() => setShowPassword(false)}
                            className="rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-3 text-xs font-semibold uppercase tracking-[0.25em] text-slate-200"
                          >
                            👁️
                          </button>
                        </div>
                      </label>
                      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                        <button type="submit" disabled={submitting} className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-60 sm:w-auto">{submitting ? "Saving…" : "Save profile"}</button>
                        <button type="button" onClick={() => setShowSignOutConfirm(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-800/80 px-3 py-3 text-sm text-slate-300 transition hover:bg-slate-700/80 sm:w-auto sm:justify-start">
                          <LogOut className="h-4 w-4" /> Sign out
                        </button>
                      </div>
                      {profileSavedAt ? (
                        <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                          <CheckCircle2 className="h-4 w-4 shrink-0" />
                          <span>Changes saved successfully at {new Date(profileSavedAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}.</span>
                        </div>
                      ) : null}
                      <div className="mt-4">
                        {showSignOutConfirm ? (
                          <div className="mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                            <p className="font-semibold">Are you sure you want to sign out?</p>
                            <div className="mt-3 flex gap-2">
                              <button type="button" onClick={handleLogout} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white">Yes, sign out</button>
                              <button type="button" onClick={() => setShowSignOutConfirm(false)} className="rounded-xl border border-slate-600 bg-slate-800/80 px-3 py-2 text-xs font-semibold text-slate-200">Cancel</button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </form>
                  </div>
                ) : null}

                {activeSection === "events" ? (
                  <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                    <h4 className="text-lg font-semibold text-white">Event roster</h4>
                    <div className="mt-4 space-y-3">
                      {orderedEvents.length === 0 ? <p className="text-sm text-slate-400">No events yet.</p> : orderedEvents.map((event) => {
                        const eventDate = parseEventDate(event.dateTime).getTime();
                        const excuseRequestDeadline = eventDate + 7 * 24 * 60 * 60 * 1000;
                        const isExcuseRequestAvailable = excuseRequestDeadline >= Date.now();
                        const attendance = eventAttendance[event.id];
                        const isExcused = excusedEventIds.has(event.id);
                        const existingExcuseRequest = submittedExcuses[event.id];
                        const draft = excuseDrafts[event.id] ?? { reason: "", excuseLetter: "", letterFile: null, signedPhoto: null, open: false };

                        return (
                          <div key={event.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-semibold text-white">{event.title}</p>
                              <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-300">{event.venue}</span>
                            </div>
                            <p className="mt-2 text-sm text-slate-400">{fmtDateTime(event.dateTime)}</p>
                            <p className="mt-1 text-sm text-slate-500">Late threshold: {event.lateThresholdMinutes} min</p>
                            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                              <div className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2">
                                <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Time in</span>
                                <span className="text-slate-200">{fmtAttendanceTime(attendance?.timeIn ?? null)}</span>
                              </div>
                              <div className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2">
                                <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Time out</span>
                                <span className="text-slate-200">{fmtAttendanceTime(attendance?.timeOut ?? null)}</span>
                              </div>
                              <div className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2">
                                <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Attendance status</span>
                                <span className={attendanceStatusClass(
                                  isExcused ? "Excused" : attendance ? getAttendanceStatus(attendance) : "Absent",
                                  Boolean(attendance?.timeOut),
                                )}>
                                  {isExcused ? "Excused" : attendance ? getAttendanceStatus(attendance) : "Absent"}
                                </span>
                                {event.requiredTimeOut ? (
                                  <span className="block text-xs text-slate-500">
                                    {attendance?.timeOut ? "Time out achieved" : `Required out: ${event.requiredTimeOut}`}
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            {isExcuseRequestAvailable ? (
                              <div className="mt-4 border-t border-white/10 pt-4">
                                {existingExcuseRequest ? (
                                  <div className="space-y-3">
                                    <button
                                      type="button"
                                      onClick={() => setExcuseDrafts((current) => ({
                                        ...current,
                                        [event.id]: {
                                          reason: current[event.id]?.reason ?? "",
                                          excuseLetter: current[event.id]?.excuseLetter ?? "",
                                          letterFile: current[event.id]?.letterFile ?? null,
                                          signedPhoto: current[event.id]?.signedPhoto ?? null,
                                          open: !(current[event.id]?.open ?? false),
                                        },
                                      }))}
                                      className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-300 transition hover:bg-cyan-500/20"
                                    >
                                      <FileText className="h-4 w-4" />
                                      Excuse Request
                                    </button>

                                    {draft.open ? (
                                      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                          <span className="font-semibold">Status: {existingExcuseRequest.status}</span>
                                          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-emerald-300">Submitted</span>
                                        </div>
                                        <div className="space-y-2">
                                          <p><span className="font-semibold text-white">Reason:</span> {existingExcuseRequest.reason || "No reason entered."}</p>
                                          <p><span className="font-semibold text-white">Soft copy:</span> {existingExcuseRequest.excuseLetterName || "Uploaded"}</p>
                                          <p><span className="font-semibold text-white">Signed letter photo:</span> {existingExcuseRequest.supportingDocumentName || "Uploaded"}</p>
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                ) : draft.open ? (
                                  <div className="space-y-3">
                                    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                                      <p className="font-semibold text-amber-200">Before you submit</p>
                                      <ol className="mt-2 list-decimal space-y-1 pl-5">
                                        <li>Make a formal excuse letter.</li>
                                        <li>Include a valid ID of your guardian in your excuse letter (back-to-back).</li>
                                        <li>Print your letter.</li>
                                        <li>Have your guardian sign it.</li>
                                        <li>Upload the soft copy of your document and take a picture of your letter signed by your guardian and upload it.</li>
                                      </ol>
                                    </div>
                                    <label className="block text-sm text-slate-300">
                                      <span className="mb-2 block text-xs uppercase tracking-[0.3em] text-slate-500">Reason</span>
                                      <textarea
                                        value={draft.reason}
                                        onChange={(inputEvent) => setExcuseDrafts((current) => ({
                                          ...current,
                                          [event.id]: {
                                            ...current[event.id],
                                            reason: inputEvent.target.value,
                                            excuseLetter: current[event.id]?.excuseLetter ?? "",
                                            letterFile: current[event.id]?.letterFile ?? null,
                                            signedPhoto: current[event.id]?.signedPhoto ?? null,
                                            open: true,
                                          },
                                        }))}
                                        placeholder="Brief reason for the excuse"
                                        className="min-h-20 w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-3 text-sm text-slate-100"
                                      />
                                    </label>
                                    <label className="block text-sm text-slate-300">
                                      <span className="mb-2 block text-xs uppercase tracking-[0.3em] text-slate-500">Soft copy of excuse letter</span>
                                      <input
                                        type="file"
                                        accept=".pdf,.doc,.docx,image/*"
                                        onChange={(inputEvent) => setExcuseDrafts((current) => ({
                                          ...current,
                                          [event.id]: {
                                            ...current[event.id],
                                            reason: current[event.id]?.reason ?? "",
                                            excuseLetter: current[event.id]?.excuseLetter ?? "",
                                            letterFile: inputEvent.target.files?.[0] ?? null,
                                            signedPhoto: current[event.id]?.signedPhoto ?? null,
                                            open: true,
                                          },
                                        }))}
                                        className="block w-full rounded-xl border border-dashed border-slate-700 bg-slate-900/80 px-3 py-3 text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-red-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                                        required
                                      />
                                      {draft.letterFile ? <p className="mt-1 text-xs text-slate-500">Selected: {draft.letterFile.name}</p> : null}
                                    </label>
                                    <label className="block text-sm text-slate-300">
                                      <span className="mb-2 block text-xs uppercase tracking-[0.3em] text-slate-500">Photo of signed letter</span>
                                      <input
                                        type="file"
                                        accept="image/*"
                                        capture="environment"
                                        onChange={(inputEvent) => setExcuseDrafts((current) => ({
                                          ...current,
                                          [event.id]: {
                                            ...current[event.id],
                                            reason: current[event.id]?.reason ?? "",
                                            excuseLetter: current[event.id]?.excuseLetter ?? "",
                                            letterFile: current[event.id]?.letterFile ?? null,
                                            signedPhoto: inputEvent.target.files?.[0] ?? null,
                                            open: true,
                                          },
                                        }))}
                                        className="block w-full rounded-xl border border-dashed border-slate-700 bg-slate-900/80 px-3 py-3 text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-red-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                                        required
                                      />
                                      {draft.signedPhoto ? <p className="mt-1 text-xs text-slate-500">Selected: {draft.signedPhoto.name}</p> : null}
                                    </label>
                                    <label className="block text-sm text-slate-300">
                                      <span className="mb-2 block text-xs uppercase tracking-[0.3em] text-slate-500">Excuse letter</span>
                                      <textarea
                                        value={draft.excuseLetter}
                                        onChange={(inputEvent) => setExcuseDrafts((current) => ({
                                          ...current,
                                          [event.id]: {
                                            ...current[event.id],
                                            reason: current[event.id]?.reason ?? "",
                                            excuseLetter: inputEvent.target.value,
                                            letterFile: current[event.id]?.letterFile ?? null,
                                            signedPhoto: current[event.id]?.signedPhoto ?? null,
                                            open: true,
                                          },
                                        }))}
                                        placeholder="Write the excuse letter details here"
                                        className="min-h-28 w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-3 text-sm text-slate-100"
                                      />
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={() => void handleSubmitExcuseLetter(event)}
                                        disabled={submitting}
                                        className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
                                      >
                                        {submitting ? "Submitting…" : "Submit excuse"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setExcuseDrafts((current) => ({
                                          ...current,
                                          [event.id]: { reason: "", excuseLetter: "", letterFile: null, signedPhoto: null, open: false },
                                        }))}
                                        className="rounded-xl border border-slate-600 bg-slate-800/80 px-3 py-2 text-sm font-semibold text-slate-200"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setExcuseDrafts((current) => ({
                                      ...current,
                                      [event.id]: { reason: current[event.id]?.reason ?? "", excuseLetter: current[event.id]?.excuseLetter ?? "", letterFile: current[event.id]?.letterFile ?? null, signedPhoto: current[event.id]?.signedPhoto ?? null, open: true },
                                    }))}
                                    className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-300 transition hover:bg-cyan-500/20"
                                  >
                                    <FileText className="h-4 w-4" />
                                    Excuse Request
                                  </button>
                                )}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {activeSection === "announcements" ? (
                  <div className={`grid gap-4 ${authUser.source === "students" ? "grid-cols-1" : "xl:grid-cols-[1.1fr_0.9fr]"}`}>
                    <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                      <h4 className="text-lg font-semibold text-white">Announcement stream</h4>
                      <div className="mt-4 space-y-3">
                        {announcements.length === 0 ? <p className="text-sm text-slate-400">No announcements yet.</p> : announcements.map((item) => (
                          <div key={item.id} className="flex min-h-[220px] flex-col rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-white">{item.title}</p>
                              <p className="mt-2 text-sm text-slate-400">{item.content}</p>
                            </div>
                            {item.imageUrl ? (
                              <button
                                type="button"
                                onClick={() => setFullSizeImage({ url: item.imageUrl ?? "", alt: item.title })}
                                className="mt-3 block w-full overflow-hidden rounded-2xl border border-slate-700 text-left"
                                aria-label={`View ${item.title} image full size`}
                              >
                                <img src={item.imageUrl} alt={item.title} className="h-48 w-full object-cover transition hover:scale-[1.02]" />
                              </button>
                            ) : null}
                            <div className="mt-4 flex items-end justify-between gap-3">
                              <span className="text-left text-xs text-slate-500">Date Created: {fmtDateTime(item.createdAt)}</span>
                              {canManageAnnouncements ? (
                                <div className="ml-auto flex gap-2">
                                  <button type="button" onClick={() => handleEditAnnouncement(item)} disabled={submitting} className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">Edit</button>
                                  <button type="button" onClick={() => void handleDeleteAnnouncement(item.id)} disabled={submitting} className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-rose-300">Delete</button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {canManageAnnouncements ? (
                      <form onSubmit={requestAnnouncementConfirmation} className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                        <h4 className="text-lg font-semibold text-white">{editingAnnouncementId ? "Edit update" : "Publish update"}</h4>
                        <div className="mt-4 space-y-3">
                          <input value={announcementForm.title} onChange={(event) => setAnnouncementForm({ ...announcementForm, title: event.target.value })} placeholder="Title" className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-sm text-slate-100" required />
                          <textarea value={announcementForm.content} onChange={(event) => setAnnouncementForm({ ...announcementForm, content: event.target.value })} placeholder="Message" className="min-h-32 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-sm text-slate-100" required />
                          <div className="space-y-2">
                            <label className="block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Announcement image</label>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(event) => {
                                const file = event.target.files?.[0] ?? null;
                                if (!file) {
                                  setAnnouncementImage(null);
                                  setAnnouncementImagePreview(null);
                                  return;
                                }
                                setAnnouncementImage(file);
                                setAnnouncementImagePreview(URL.createObjectURL(file));
                              }}
                              className="block w-full rounded-xl border border-dashed border-slate-700 bg-slate-950/70 px-3 py-3 text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-red-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                            />
                          </div>
                          {announcementImagePreview ? (
                            <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/60">
                              <img src={announcementImagePreview} alt="Announcement preview" className="h-40 w-full object-cover" />
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button type="submit" disabled={submitting} className="rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-60">{submitting ? (editingAnnouncementId ? "Updating…" : "Publishing…") : (editingAnnouncementId ? "Update announcement" : "Post announcement")}</button>
                          {editingAnnouncementId ? (
                            <button type="button" onClick={() => { setEditingAnnouncementId(null); setAnnouncementForm({ title: "", content: "" }); setAnnouncementImage(null); setAnnouncementImagePreview(null); setAnnouncementPreview(null); }} className="rounded-xl border border-slate-600 bg-slate-800/80 px-3 py-3 text-sm font-semibold text-slate-200">Cancel edit</button>
                          ) : null}
                        </div>
                        {announcementPreview ? (
                          <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                            <p className="text-sm font-semibold text-amber-200">Review your announcement before submitting</p>
                            <div className="mt-3 space-y-2 text-sm text-slate-300">
                              <p><span className="font-medium text-white">Title:</span> {announcementPreview.title}</p>
                              <p><span className="font-medium text-white">Message:</span> {announcementPreview.content}</p>
                              {announcementPreview.imageUrl ? (
                                <button
                                  type="button"
                                  onClick={() => setFullSizeImage({ url: announcementPreview.imageUrl ?? "", alt: "Announcement review" })}
                                  className="block w-full overflow-hidden rounded-xl border border-slate-700 text-left"
                                  aria-label="View announcement image full size"
                                >
                                  <img src={announcementPreview.imageUrl} alt="Announcement review" className="h-44 w-full object-cover transition hover:scale-[1.02]" />
                                </button>
                              ) : null}
                            </div>
                            <div className="mt-4 flex gap-2">
                              <button type="button" onClick={() => void handleCreateAnnouncement()} disabled={submitting} className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60">Confirm</button>
                              <button type="button" onClick={() => setAnnouncementPreview(null)} className="rounded-xl border border-slate-600 bg-slate-800/80 px-3 py-2 text-sm font-semibold text-slate-200">Cancel</button>
                            </div>
                          </div>
                        ) : null}
                      </form>
                    ) : null}
                  </div>
                ) : null}

                {activeSection === "money" ? (
                  <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                    <div className="mb-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                        <p className="text-sm text-emerald-200/70">Fine records</p>
                        <p className="mt-1 text-2xl font-semibold text-emerald-200">{payments.length}</p>
                        <p className="mt-1 text-xs text-emerald-200/60">Attendance rows with a calculated fine.</p>
                      </div>
                      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                        <p className="text-sm text-amber-200/70">Amount to pay</p>
                        <p className="mt-1 text-2xl font-semibold text-amber-200">{currency.format(pendingAmount)}</p>
                        <p className="mt-1 text-xs text-amber-200/60">Based only on event_attendance.calculated_fine.</p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                        <h4 className="text-lg font-semibold text-white">Attendance fine report</h4>
                        <div className="flex flex-wrap gap-2">
                          {(["all", "Fee", "Fine", "Contribution"] as const).map((option) => {
                            const active = moneyFilter === option;
                            return (
                              <button
                                key={option}
                                type="button"
                                onClick={() => setMoneyFilter(option)}
                                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${active ? "border-red-500/30 bg-red-600/15 text-white" : "border-white/10 bg-slate-800/80 text-slate-300 hover:border-slate-500"}`}
                              >
                                {option === "all" ? "All" : paymentTypeLabel(option)}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3 md:grid-cols-3">
                        <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                          From
                          <input
                            type="date"
                            value={moneyDateFrom}
                            onChange={(event) => setMoneyDateFrom(event.target.value)}
                            className="rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
                          />
                        </label>
                        <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                          To
                          <input
                            type="date"
                            value={moneyDateTo}
                            onChange={(event) => setMoneyDateTo(event.target.value)}
                            className="rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
                          />
                        </label>
                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => {
                              setMoneyFilter("all");
                              setMoneyDateFrom("");
                              setMoneyDateTo("");
                            }}
                            className="w-full rounded-xl border border-slate-600 bg-slate-800/80 px-3 py-2 text-sm font-semibold text-slate-200"
                          >
                            Clear filters
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 space-y-3">
                      {filteredPayments.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-5 text-sm text-slate-400">
                          {authUser?.roleName?.toLowerCase() === "student" || authUser?.role === "student" ? (
                            <>
                              <p className="font-medium text-slate-300">No event attendance records found for this student.</p>
                              <p className="mt-1">The report includes every attendance record and reads the amount from event_attendance.calculated_fine.</p>
                            </>
                          ) : (
                            <>
                              <p className="font-medium text-slate-300">No attendance records match the current filters.</p>
                              <p className="mt-1">The report reads amounts from event_attendance.calculated_fine.</p>
                            </>
                          )}
                        </div>
                      ) : filteredPayments.map((payment) => (
                        <div key={payment.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-white">{payment.title}</p>
                            <span className={`rounded-full px-2 py-1 text-xs ${payment.amount === 0 ? "bg-slate-500/10 text-slate-300" : "bg-amber-500/10 text-amber-300"}`}>
                              {payment.amount === 0 ? "No fine" : "Amount due"}
                            </span>
                          </div>
                            <p className="mt-2 text-sm text-slate-400">
                              {payment.type} • {currency.format(payment.amount)}
                              {payment.remainingAmount !== undefined ? ` • Left to pay: ${currency.format(payment.remainingAmount)}` : ""}
                            </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            {payment.paymentDate ? <span>Created: {new Date(payment.paymentDate).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })}</span> : null}
                            {payment.remarks ? <span>• {payment.remarks}</span> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {activeSection === "rankings" ? (
                  <div className="space-y-4 rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                    <h4 className="text-lg font-semibold text-white">Member rankings</h4>

                    {[
                      {
                        label: "Most fines",
                        entries: rankings.fines,
                        formatter: (value: number) => `${currency.format(value)}`,
                        valueSelector: (entry: any) => entry.fines,
                      },
                      {
                        label: "Most hours",
                        entries: rankings.hours,
                        formatter: (value: number) => `${value.toFixed(1)} hrs`,
                        valueSelector: (entry: any) => entry.hours,
                      },
                      {
                        label: "Early bird",
                        entries: rankings.early,
                        formatter: (value: number) => `${value.toFixed(1)} min early`,
                        valueSelector: (entry: any) => entry.earlyBirds > 0 ? entry.earlyMinutesTotal / entry.earlyBirds : 0,
                      },
                      {
                        label: "Late bird",
                        entries: rankings.late,
                        formatter: (value: number) => `${value.toFixed(1)} min late`,
                        valueSelector: (entry: any) => entry.lateMinutesTotal,
                      },
                    ].map((section) => (
                      <div key={section.label} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <h5 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">{section.label}</h5>
                          <span className="text-xs text-slate-500">Top 5</span>
                        </div>
                        <div className="space-y-2">
                          {section.entries.length === 0 ? (
                            <p className="text-sm text-slate-400">No attendance data yet.</p>
                          ) : section.entries.map((entry, index) => (
                            <div key={`${section.label}-${entry.studentId}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-white">{index + 1}. {entry.studentId}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-semibold text-amber-300">{section.formatter(section.valueSelector(entry))}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </main>
        </div>
      </div>
      {fullSizeImage ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Full-size announcement image"
          onClick={() => setFullSizeImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 sm:p-8"
        >
          <button
            type="button"
            onClick={() => setFullSizeImage(null)}
            aria-label="Close full-size image"
            className="absolute right-4 top-4 rounded-full border border-white/20 bg-slate-900/80 p-2 text-white transition hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={fullSizeImage.url}
            alt={fullSizeImage.alt}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[calc(100vh-2rem)] max-w-full object-contain sm:max-h-[calc(100vh-4rem)]"
          />
        </div>
      ) : null}
    </div>
  );
}

export default App;
