export function parseAuctionDate(raw: string | null | undefined): Date | null {
  if (!raw || typeof raw !== 'string') return null;
  
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'future') {
    return null;
  }
  
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) {
    return null;
  }
  
  return d;
}
