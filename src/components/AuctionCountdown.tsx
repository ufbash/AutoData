import React, { useState, useEffect } from 'react';
import { parseAuctionDate } from '../utils/auctionDate';

interface AuctionCountdownProps {
  saleDateText: string | null;
}

const AuctionCountdown: React.FC<AuctionCountdownProps> = ({ saleDateText }) => {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 1000); // Tick every second
    return () => clearInterval(interval);
  }, []);

  const d = parseAuctionDate(saleDateText);
  if (!d) {
    return <span className="text-xs font-bold text-gray-500 uppercase">Auction date TBC</span>;
  }

  const msRemaining = d.getTime() - now.getTime();
  
  if (msRemaining < 0) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Auction passed</span>
        <span className="text-[10px] text-gray-400">{d.toLocaleString()}</span>
      </div>
    );
  }

  const days = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
  const hours = Math.floor((msRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((msRemaining % (1000 * 60 * 60)) / (1000 * 60));
  const secs = Math.floor((msRemaining % (1000 * 60)) / 1000);

  const isUrgent = msRemaining < 1000 * 60 * 60; // less than 1 hour
  const isRed = msRemaining < 1000 * 60 * 60 * 48; // less than 48 hours

  const timeStr = `${days > 0 ? `${days}d ` : ''}${hours}h ${mins}m ${secs}s`;

  let colorClass = 'text-amber-500';
  if (isUrgent) {
    colorClass = 'text-red-600 animate-pulse';
  } else if (isRed) {
    colorClass = 'text-red-600';
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className={`font-black text-[13px] uppercase tracking-wider ${colorClass}`}>
        {isUrgent ? 'URGENT: ' : ''}Auction in {timeStr}
      </span>
      <span className="text-[11px] text-gray-500 font-medium">
        {d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </span>
    </div>
  );
};

export default AuctionCountdown;
