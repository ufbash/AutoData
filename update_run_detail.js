const fs = require('fs');

const path = '/Users/cc/AutoData/src/components/ResearchRunDetail.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add GripVertical and Menu to imports
content = content.replace(
  /import \{ (.*?) \} from 'lucide-react';/,
  "import { $1, GripVertical } from 'lucide-react';"
);

// 2. Add drag state and handlers
const stateCode = `
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) {
      handleDragEnd();
      return;
    }
    const nextListings = [...listings];
    const [removed] = nextListings.splice(draggedIndex, 1);
    nextListings.splice(dropIndex, 0, removed);
    setListings(nextListings);
    handleDragEnd();
    try {
      await reorderListings(runId, nextListings.map(l => l.id));
    } catch (err: any) {
      alert(err.message || 'Failed to reorder');
      loadData();
    }
  };
`;

content = content.replace(
  /const handleMove = async \(index: number, direction: -1 \| 1\) => \{[\s\S]*?\};/,
  stateCode
);

// 3. Update summary stats section
const summaryCode = `
  const includedListings = listings.filter(l => l.included);
  const includedCount = includedListings.length;

  let totalPrice = 0;
  let priceCount = 0;
  let minPrice = Infinity;
  let maxPrice = -Infinity;
  let totalMileage = 0;
  let mileageCount = 0;

  includedListings.forEach(l => {
    const price = l.current_bid_usd ?? l.listed_price ?? null;
    if (price !== null) {
      totalPrice += price;
      priceCount++;
      if (price < minPrice) minPrice = price;
      if (price > maxPrice) maxPrice = price;
    }
    if (l.mileage_miles !== null) {
      totalMileage += l.mileage_miles;
      mileageCount++;
    }
  });

  const avgPrice = priceCount > 0 ? totalPrice / priceCount : null;
  const avgMileage = mileageCount > 0 ? totalMileage / mileageCount : null;
`;

content = content.replace(
  /const includedCount = listings.filter\(l => l.included\).length;/,
  summaryCode
);

// 4. Add summary stats UI in header
const headerCode = `
          <div>
            <h3 className="text-lg font-bold text-[#403f4c] flex items-center gap-2">
              Run Listings
            </h3>
            <p className="text-sm text-gray-500 mt-1">{includedCount} of {listings.length} listings included.</p>
            <div className="flex gap-4 mt-3 flex-wrap">
              <div className="bg-white px-4 py-2 rounded-lg border border-gray-100 shadow-sm text-sm">
                <div className="text-gray-500 text-xs mb-1">Avg price ({priceCount} included with price)</div>
                <div className="font-bold text-[#403f4c]">
                  {avgPrice !== null ? \`$\${Math.round(avgPrice).toLocaleString()}\` : '—'}
                </div>
              </div>
              <div className="bg-white px-4 py-2 rounded-lg border border-gray-100 shadow-sm text-sm">
                <div className="text-gray-500 text-xs mb-1">Min / Max Price</div>
                <div className="font-bold text-[#403f4c]">
                  {priceCount > 0 ? \`$\${Math.round(minPrice).toLocaleString()} / $\${Math.round(maxPrice).toLocaleString()}\` : '—'}
                </div>
              </div>
              <div className="bg-white px-4 py-2 rounded-lg border border-gray-100 shadow-sm text-sm">
                <div className="text-gray-500 text-xs mb-1">Avg Mileage</div>
                <div className="font-bold text-[#403f4c]">
                  {avgMileage !== null ? \`\${Math.round(avgMileage).toLocaleString()} mi\` : '—'}
                </div>
              </div>
            </div>
          </div>
`;
content = content.replace(
  /<div>\s*<h3 className="text-lg font-bold text-\[\#403f4c\] flex items-center gap-2">\s*Run Listings\s*<\/h3>\s*<p className="text-sm text-gray-500 mt-1">\{includedCount\} of \{listings\.length\} listings included\.<\/p>\s*<\/div>/,
  headerCode
);

// 5. Update tr and table rows for drag and drop
content = content.replace(
  /<tr key=\{listing.id\} className=\{`hover:bg-gray-50 transition-colors \$\{!listing\.included \? 'opacity-60' : ''\}`\}>/,
  \`<tr 
    key={listing.id} 
    draggable={true}
    onDragStart={(e) => handleDragStart(e, index)}
    onDragOver={(e) => handleDragOver(e, index)}
    onDrop={(e) => handleDrop(e, index)}
    onDragEnd={handleDragEnd}
    className={\`hover:bg-gray-50 transition-colors \${!listing.included ? 'opacity-60' : ''} \${dragOverIndex === index ? 'border-t-2 border-[#a58039] bg-orange-50/50' : ''}\`}
  >\`
);

// 6. Replace order column with drag handle
const orderHtml = `
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2 cursor-grab active:cursor-grabbing opacity-50 hover:opacity-100 transition-opacity">
                        <GripVertical className="w-5 h-5 text-gray-400" />
                        <span className="w-4 text-center text-xs font-medium text-gray-500">{index + 1}</span>
                      </div>
                    </td>
`;
content = content.replace(
  /<td className="px-4 py-3">\s*<div className="flex items-center justify-center gap-1">\s*<button[\s\S]*?<\/button>\s*<span className="w-4 text-center text-xs font-medium text-gray-500">\{index \+ 1\}<\/span>\s*<button[\s\S]*?<\/button>\s*<\/div>\s*<\/td>/,
  orderHtml
);

// 7. Update image to use placeholder on error and referrerPolicy
content = content.replace(
  /<img src=\{listing.image_urls\[0\]\} alt="thumbnail" className="w-full h-full object-cover" \/>/,
  \`<img 
    src={listing.image_urls[0]} 
    alt="thumbnail" 
    className="w-full h-full object-cover" 
    referrerPolicy="no-referrer"
    onError={(e) => {
      e.currentTarget.style.display = 'none';
      const div = document.createElement('div');
      div.className = 'w-full h-full flex items-center justify-center bg-gray-200 text-[10px] text-gray-500 font-medium text-center leading-tight p-1';
      div.innerText = \`\${listing.year || ''} \${listing.make} \${listing.model}\`.trim();
      e.currentTarget.parentNode?.appendChild(div);
    }}
  />\`
);

// 8. Update price display logic
const priceDisplayHtml = `
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-[#403f4c]">
                          <span className="text-gray-500 text-xs block mb-0.5">
                            {listing.current_bid_usd !== null ? 'Current bid' : 'Listed price'}
                          </span>
                          {(listing.current_bid_usd ?? listing.listed_price) !== null 
                            ? \`\${listing.listed_currency && listing.listed_currency !== 'USD' && listing.current_bid_usd === null ? listing.listed_currency + ' ' : '$'}\${(listing.current_bid_usd ?? listing.listed_price!).toLocaleString()}\`
                            : '—'}
                        </div>
                        {listing.estimated_retail_value_usd !== null && (
                          <div className="text-xs text-gray-500 mt-1">Est retail: ${"$"}{listing.estimated_retail_value_usd.toLocaleString()}</div>
                        )}
                      </div>
                    </td>
`;
content = content.replace(
  /<td className="px-4 py-3">\s*<div className="space-y-1">\s*\{listing.current_bid_usd !== null[\s\S]*?<\/div>\s*<\/td>/,
  priceDisplayHtml
);

fs.writeFileSync(path, content);
console.log('ResearchRunDetail.tsx updated successfully');
