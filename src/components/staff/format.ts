export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export const fmtTimePrecise = (iso: string) => {
  const d = new Date(iso);
  return `${fmtTime(iso)}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
