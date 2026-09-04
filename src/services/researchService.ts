import { supabase } from './supabaseClient';

export interface Client {
  id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  preferred_contact?: 'phone' | 'whatsapp' | 'email' | null;
  assigned_agent?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface ClientBrief {
  id: string;
  client_id: string;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  year_min?: number | null;
  year_max?: number | null;
  max_mileage?: number | null;
  transmission?: 'automatic' | 'manual' | 'either' | null;
  fuel_type?: 'petrol' | 'diesel' | 'hybrid' | 'electric' | 'either' | null;
  condition_required?: 'run_and_drive' | 'starts_needs_work' | 'non_running' | 'salvage_only' | 'either' | null;
  titles_accepted?: string[] | null;
  colour_preference?: string | null;
  interior_preference?: string | null;
  quantity: number;
  max_budget_usd?: number | null;
  max_bid_usd?: number | null;
  additional_notes?: string | null;
  created_at: string;
}

export interface ResearchRun {
  id: string;
  client_name: string;
  target_spec: Record<string, unknown> | null;
  status: 'draft' | 'active' | 'completed' | 'archived';
  notes: string | null;
  share_token: string;
  share_enabled: boolean;
  run_type: 'sold_comps' | 'active_listings' | 'mixed';
  deleted_at?: string | null;
  deleted_by?: string | null;
  created_at: string;
  updated_at: string;
  listing_count?: number;
  critical_override_reason?: string | null;
  critical_override_by?: string | null;
  critical_override_at?: string | null;
  client_id?: string | null;
  client_brief_id?: string | null;
  client?: Client | null;
  client_brief?: ClientBrief | null;
}

export interface RunListing {
  id: string;
  sighting_id: string;
  asset_id: string | null;
  position: number | null;
  included: boolean;
  notes: string | null;
  source_platform: string;
  source_url: string | null;
  lot_number: string | null;
  mileage_miles: number | null;
  damage_type: string | null;
  secondary_damage: string | null;
  title_type: string | null;
  location: string | null;
  current_bid_usd: number | null;
  listed_price: number | null;
  listed_currency: string | null;
  estimated_retail_value_usd: number | null;
  estimated_cost_low_usd: number | null;
  estimated_cost_high_usd: number | null;
  seller_type: string | null;
  sale_date: string | null;
  has_key: boolean | null;
  runs_and_drives: boolean | null;
  engine_starts: boolean | null;
  transmission_engages: boolean | null;
  highlights: string[];
  image_urls: string[];
  logged_via: string;
  captured_at: string;
  price_usd: number | null;
  lot_state: 'active' | 'finished' | 'unknown' | null;
  sale_confirmed?: boolean | null;
  make: string;
  model: string;
  trim: string | null;
  year: number | null;
  vin: string | null;
  body_style: string | null;
  cylinders: number | null;
  engine_type: string | null;
  horsepower: number | null;
  transmission: string | null;
  fuel: string | null;
  drivetrain: string | null;
  exterior_color: string | null;
  stored_image_urls?: string[];
  image_store_status?: string | null;
  images_stored_at?: string | null;
}

export const listRuns = async (orgId: string): Promise<ResearchRun[]> => {
  const { data, error } = await supabase
    .from('research_runs')
    .select('*, research_run_listings(count), client:clients(*), client_brief:client_briefs(*)')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list research runs: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    ...row,
    listing_count: row.research_run_listings?.[0]?.count || 0,
  }));
};

export const createRun = async (orgId: string, input: { client_name: string; run_type: 'sold_comps' | 'active_listings' | 'mixed'; notes?: string; target_spec?: object; client_id?: string; client_brief_id?: string }): Promise<ResearchRun> => {
  const share_token = Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const { data, error } = await supabase
    .from('research_runs')
    .insert({
      org_id: orgId,
      client_name: input.client_name,
      run_type: input.run_type,
      notes: input.notes || null,
      target_spec: input.target_spec || null,
      client_id: input.client_id || null,
      client_brief_id: input.client_brief_id || null,
      share_token,
      share_enabled: false
    })
    .select('*, client:clients(*), client_brief:client_briefs(*)')
    .single();

  if (error) {
    throw new Error(`Failed to create research run: ${error.message}`);
  }

  return data;
};

export const getRun = async (runId: string): Promise<ResearchRun> => {
  const { data, error } = await supabase
    .from('research_runs')
    .select('*, client:clients(*), client_brief:client_briefs(*)')
    .eq('id', runId)
    .is('deleted_at', null)
    .single();

  if (error) {
    throw new Error(`Failed to fetch run: ${error.message}`);
  }

  return data;
};

// --- Clients and Briefs API ---

export const listClients = async (orgId: string): Promise<Client[]> => {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list clients: ${error.message}`);
  return data || [];
};

export const createClient = async (orgId: string, client: Partial<Client>): Promise<Client> => {
  const { data, error } = await supabase
    .from('clients')
    .insert({ ...client, org_id: orgId })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create client: ${error.message}`);
  return data;
};

export const listClientBriefs = async (orgId: string, clientId?: string): Promise<ClientBrief[]> => {
  let q = supabase
    .from('client_briefs')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  
  if (clientId) {
    q = q.eq('client_id', clientId);
  }

  const { data, error } = await q;
  if (error) throw new Error(`Failed to list client briefs: ${error.message}`);
  return data || [];
};

export const createClientBrief = async (orgId: string, clientId: string, brief: Partial<ClientBrief>): Promise<ClientBrief> => {
  const { data, error } = await supabase
    .from('client_briefs')
    .insert({ ...brief, org_id: orgId, client_id: clientId })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create client brief: ${error.message}`);
  return data;
};

export const updateClient = async (clientId: string, patch: Partial<Client>): Promise<Client> => {
  const { data, error } = await supabase
    .from('clients')
    .update(patch)
    .eq('id', clientId)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update client: ${error.message}`);
  return data;
};

export const updateClientBrief = async (briefId: string, patch: Partial<ClientBrief>): Promise<ClientBrief> => {
  const { data, error } = await supabase
    .from('client_briefs')
    .update(patch)
    .eq('id', briefId)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update client brief: ${error.message}`);
  return data;
};

export const softDeleteClient = async (clientId: string, userId: string): Promise<void> => {
  // Check for active briefs
  const { count: briefCount, error: briefError } = await supabase
    .from('client_briefs')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .is('deleted_at', null);
  
  if (briefError) throw new Error(`Failed to check client briefs: ${briefError.message}`);
  
  // Check for active runs
  const { count: runCount, error: runError } = await supabase
    .from('research_runs')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .is('deleted_at', null);

  if (runError) throw new Error(`Failed to check client runs: ${runError.message}`);

  if ((briefCount && briefCount > 0) || (runCount && runCount > 0)) {
    const msgs = [];
    if (runCount && runCount > 0) msgs.push(`${runCount} active run(s)`);
    if (briefCount && briefCount > 0) msgs.push(`${briefCount} active brief(s)`);
    throw new Error(`Cannot delete this client because they still have ${msgs.join(' and ')}. Please delete or reassign them first.`);
  }

  const { error } = await supabase
    .from('clients')
    .update({ 
      deleted_at: new Date().toISOString(),
      deleted_by: userId
    })
    .eq('id', clientId);

  if (error) throw new Error(`Failed to delete client: ${error.message}`);
};

export const softDeleteClientBrief = async (briefId: string, userId: string): Promise<void> => {
  const { error } = await supabase
    .from('client_briefs')
    .update({ 
      deleted_at: new Date().toISOString(),
      deleted_by: userId
    })
    .eq('id', briefId);

  if (error) throw new Error(`Failed to delete client brief: ${error.message}`);
};

export const listDeletedClients = async (orgId: string): Promise<Client[]> => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('org_id', orgId)
    .not('deleted_at', 'is', null)
    .gte('deleted_at', thirtyDaysAgo.toISOString())
    .order('deleted_at', { ascending: false });

  if (error) throw new Error(`Failed to list deleted clients: ${error.message}`);
  return data || [];
};

export const restoreClient = async (clientId: string): Promise<void> => {
  const { error } = await supabase
    .from('clients')
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', clientId);
  if (error) throw new Error(`Failed to restore client: ${error.message}`);
};

export const listDeletedClientBriefs = async (orgId: string): Promise<ClientBrief[]> => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data, error } = await supabase
    .from('client_briefs')
    .select('*')
    .eq('org_id', orgId)
    .not('deleted_at', 'is', null)
    .gte('deleted_at', thirtyDaysAgo.toISOString())
    .order('deleted_at', { ascending: false });

  if (error) throw new Error(`Failed to list deleted briefs: ${error.message}`);
  return data || [];
};

export const restoreClientBrief = async (briefId: string): Promise<void> => {
  const { error } = await supabase
    .from('client_briefs')
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', briefId);
  if (error) throw new Error(`Failed to restore brief: ${error.message}`);
};

export const updateRun = async (runId: string, patch: Partial<Pick<ResearchRun, 'client_name' | 'notes' | 'status' | 'share_enabled' | 'run_type'>>): Promise<ResearchRun> => {
  const { data, error } = await supabase
    .from('research_runs')
    .update(patch)
    .eq('id', runId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update research run: ${error.message}`);
  }

  return data;
};

export const deleteSighting = async (sightingId: string, assetId: string): Promise<void> => {
  const { error: deleteError } = await supabase
    .from('sightings')
    .delete()
    .eq('id', sightingId);
  
  if (deleteError) {
    throw new Error(`Failed to delete sighting: ${deleteError.message}`);
  }

  // Check if any other sightings exist for this asset
  const { data: remainingSightings, error: checkError } = await supabase
    .from('sightings')
    .select('id')
    .eq('asset_id', assetId)
    .limit(1);

  if (!checkError && (!remainingSightings || remainingSightings.length === 0)) {
    // Attempt to delete asset (best effort)
    await supabase.from('assets').delete().eq('id', assetId);
  }
};

export interface AuctionHistoryRecord {
  asset_id: string;
  auction_platform: string | null;
  auction_date: string | null;
  lot_number: string | null;
  bid_amount_usd: number | null;
  odometer_miles: number | null;
  status: string | null;
}

export const listAuctionHistoryForAssets = async (assetIds: string[]): Promise<Map<string, AuctionHistoryRecord[]>> => {
  const map = new Map<string, AuctionHistoryRecord[]>();
  const uniqueIds = Array.from(new Set(assetIds.filter(Boolean)));
  if (uniqueIds.length === 0) return map;

  const { data, error } = await supabase
    .from('auction_history')
    .select('asset_id, auction_platform, auction_date, lot_number, bid_amount_usd, odometer_miles, status')
    .in('asset_id', uniqueIds);

  if (error) {
    throw new Error(`Failed to list auction history: ${error.message}`);
  }

  (data || []).forEach((row: AuctionHistoryRecord) => {
    if (!map.has(row.asset_id)) map.set(row.asset_id, []);
    map.get(row.asset_id)!.push(row);
  });

  return map;
};

export const listRunListings = async (runId: string): Promise<RunListing[]> => {
  const { data, error } = await supabase
    .from('research_run_listings')
    .select(`
      id,
      sighting_id,
      position,
      included,
      notes,
      sightings (
        asset_id,
        source_platform,
        source_url,
        lot_number,
        mileage_miles,
        damage_type,
        secondary_damage,
        title_type,
        location,
        seller_type,
        sale_date,
        has_key,
        runs_and_drives,
        engine_starts,
        transmission_engages,
        highlights,
        image_urls,
        logged_via,
        captured_at,
        raw_payload,
        listed_price,
        listed_currency,
        price_usd,
        lot_state,
        sale_confirmed,
        stored_image_urls,
        image_store_status,
        images_stored_at,
        assets (
          make,
          model,
          trim,
          year,
          vin,
          body_style,
          cylinders,
          engine_type,
          horsepower,
          transmission,
          fuel,
          drivetrain,
          exterior_color
        )
      )
    `)
    .eq('run_id', runId)
    .order('position', { ascending: true, nullsFirst: false });

  if (error) {
    throw new Error(`Failed to list run listings: ${error.message}`);
  }

  return (data || []).map((row: any) => {
    const sighting = Array.isArray(row.sightings) ? row.sightings[0] : (row.sightings || {});
    const asset = Array.isArray(sighting.assets) ? sighting.assets[0] : (sighting.assets || {});
    const raw = sighting.raw_payload || {};
    return {
      id: row.id,
      sighting_id: row.sighting_id,
      asset_id: sighting.asset_id || null,
      position: row.position,
      included: row.included,
      notes: row.notes,
      source_platform: sighting.source_platform || 'unknown',
      source_url: sighting.source_url || null,
      lot_number: sighting.lot_number || null,
      mileage_miles: sighting.mileage_miles || null,
      damage_type: sighting.damage_type || null,
      secondary_damage: sighting.secondary_damage || null,
      title_type: sighting.title_type || null,
      location: sighting.location || null,
      current_bid_usd: raw.current_bid_usd ?? null,
      listed_price: sighting.listed_price ?? null,
      listed_currency: sighting.listed_currency ?? null,
      estimated_retail_value_usd: raw.estimated_retail_value_usd ?? null,
      estimated_cost_low_usd: raw.estimated_cost_low_usd ?? null,
      estimated_cost_high_usd: raw.estimated_cost_high_usd ?? null,
      seller_type: sighting.seller_type || null,
      sale_date: sighting.sale_date || null,
      has_key: sighting.has_key ?? null,
      runs_and_drives: sighting.runs_and_drives ?? null,
      engine_starts: sighting.engine_starts ?? null,
      transmission_engages: sighting.transmission_engages ?? null,
      highlights: sighting.highlights || [],
      image_urls: sighting.image_urls || [],
      logged_via: sighting.logged_via || 'unknown',
      captured_at: sighting.captured_at,
      price_usd: sighting.price_usd ?? null,
      lot_state: sighting.lot_state ?? null,
      sale_confirmed: sighting.sale_confirmed ?? null,
      make: asset.make || 'Unknown',
      model: asset.model || 'Unknown',
      trim: asset.trim || null,
      year: asset.year || null,
      vin: asset.vin || null,
      body_style: asset.body_style || null,
      cylinders: asset.cylinders || null,
      engine_type: asset.engine_type || null,
      horsepower: asset.horsepower || null,
      transmission: asset.transmission || null,
      fuel: asset.fuel || null,
      drivetrain: asset.drivetrain || null,
      exterior_color: asset.exterior_color || null,
      stored_image_urls: sighting.stored_image_urls || undefined,
      image_store_status: sighting.image_store_status || null,
      images_stored_at: sighting.images_stored_at || null,
    };
  }).sort((a, b) => {
    if (a.position === b.position) {
      if (a.captured_at && b.captured_at) {
        return new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime();
      }
      return 0;
    }
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    return a.position - b.position;
  });
};

export const setListingIncluded = async (listingId: string, included: boolean): Promise<void> => {
  const { error } = await supabase
    .from('research_run_listings')
    .update({ included })
    .eq('id', listingId);

  if (error) {
    throw new Error(`Failed to set listing inclusion: ${error.message}`);
  }
};

export const reorderListings = async (runId: string, orderedListingIds: string[]): Promise<void> => {
  const updates = orderedListingIds.map((id, index) =>
    supabase
      .from('research_run_listings')
      .update({ position: index })
      .eq('id', id)
  );

  const results = await Promise.all(updates);

  for (const { error } of results) {
    if (error) {
      throw new Error(`Failed to reorder listings: ${error.message}`);
    }
  }
};

export const attachSightingToRun = async (orgId: string, runId: string, sightingId: string): Promise<void> => {
  // Fetch run type
  const { data: runData, error: runError } = await supabase
    .from('research_runs')
    .select('run_type')
    .eq('id', runId)
    .single();

  if (runError) throw new Error(`Failed to get run type: ${runError.message}`);
  
  const { data: sightingData, error: sightingError } = await supabase
    .from('sightings')
    .select('price_usd, lot_state, raw_payload, listed_price, source_platform, sale_confirmed, logged_via')
    .eq('id', sightingId)
    .single();
    
  if (sightingError) throw new Error(`Failed to get sighting: ${sightingError.message}`);

  const sightingObj = {
    source_platform: sightingData.source_platform,
    lot_state: sightingData.lot_state,
    price_usd: sightingData.price_usd,
    current_bid_usd: sightingData.raw_payload?.current_bid_usd ?? null,
    sale_confirmed: sightingData.sale_confirmed
  };

  const isFinished = (l: any) => l.lot_state === 'finished';
  const isAuctionSource = (l: any) => ['copart','bidcars','iaai'].includes(l.source_platform);
  const hasValue = (v: any) => v !== null && v !== undefined;
  const isUnconfirmed = l => l.sale_confirmed === false;

  const eligibleActive = (l: any) => isAuctionSource(l) && !isFinished(l);
  const eligibleSold = (l: any) => hasValue(l.price_usd) && !hasValue(l.current_bid_usd) && l.lot_state !== 'active' && !isUnconfirmed(l);

  if (runData.run_type === 'sold_comps') {
    if (!eligibleSold(sightingObj)) {
      throw new Error("Only sold or settled listings can be added to a market-research run.");
    }
  } else if (runData.run_type === 'active_listings') {
    if (!eligibleActive(sightingObj)) {
      throw new Error("Only live auction listings can be added to a client-options run.");
    }
  }
  const { data, error: countError } = await supabase
    .from('research_run_listings')
    .select('position')
    .eq('run_id', runId)
    .order('position', { ascending: false })
    .limit(1);

  if (countError) {
    throw new Error(`Failed to get max position: ${countError.message}`);
  }

  const maxPosition = data && data.length > 0 && data[0].position !== null ? data[0].position : -1;

  const { error } = await supabase
    .from('research_run_listings')
    .insert({
      org_id: orgId,
      run_id: runId,
      sighting_id: sightingId,
      position: maxPosition + 1,
    });

  if (error) {
    if (error.code === '23505') { // unique constraint violation
      return;
    }
    throw new Error(`Failed to attach sighting to run: ${error.message}`);
  }

  // Fire-and-forget image storage trigger
  // Wrapped in try/catch so it never blocks or fails the attach operation
  (async () => {
    try {
      await supabase.functions.invoke('store-images', {
        body: { sighting_ids: [sightingId] }
      });
    } catch (e) {
      console.warn(`Failed to trigger image storage for sighting ${sightingId}`, e);
    }
  })();
};

export const removeListingFromRun = async (listingId: string): Promise<void> => {
  const { error } = await supabase
    .from('research_run_listings')
    .delete()
    .eq('id', listingId);

  if (error) {
    throw new Error(`Failed to remove listing from run: ${error.message}`);
  }
};

export const rotateShareToken = async (runId: string): Promise<string> => {
  const share_token = Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const { error } = await supabase
    .from('research_runs')
    .update({ share_token })
    .eq('id', runId);

  if (error) {
    throw new Error(`Failed to rotate share token: ${error.message}`);
  }

  return share_token;
};

export interface AvailableSighting {
  sighting_id: string;
  asset_id: string;
  make: string;
  model: string;
  trim: string | null;
  year: number | null;
  mileage_miles: number | null;
  damage_type: string | null;
  source_platform: string;
  logged_via: string;
  captured_at: string;
  image_urls: string[];
  lot_number: string | null;
  listed_price: number | null;
  listed_currency: string | null;
  price_usd: number | null;
  lot_state: string | null;
  current_bid_usd: number | null;
  sale_confirmed?: boolean | null;
}

export async function listAvailableSightings(
  orgId: string,
  excludeSightingIds: string[],
  limit = 60,
  offset = 0
): Promise<AvailableSighting[]> {
  const { data, error } = await supabase
    .from('sightings')
    .select(`
      id,
      source_platform,
      logged_via,
      captured_at,
      image_urls,
      mileage_miles,
      damage_type,
      lot_number,
      listed_price,
      listed_currency,
      price_usd,
      lot_state,
      sale_confirmed,
      raw_payload,
      assets (
        id,
        make,
        model,
        trim,
        year
      )
    `)
    .eq('org_id', orgId)
    .order('captured_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list available sightings: ${error.message}`);
  }

  const excludeSet = new Set(excludeSightingIds);
  const available = (data || [])
    .filter((row: any) => !excludeSet.has(row.id))
    .slice(offset, offset + limit)
    .map((row: any) => {
      const asset = Array.isArray(row.assets) ? row.assets[0] : (row.assets || {});
      return {
        sighting_id: row.id,
        asset_id: asset.id || '',
        make: asset.make || 'Unknown',
        model: asset.model || 'Unknown',
        trim: asset.trim || null,
        year: asset.year || null,
        mileage_miles: row.mileage_miles,
        damage_type: row.damage_type,
        source_platform: row.source_platform || 'unknown',
        logged_via: row.logged_via || 'unknown',
        captured_at: row.captured_at,
        image_urls: row.image_urls || [],
        lot_number: row.lot_number,
        listed_price: row.listed_price ?? null,
        listed_currency: row.listed_currency ?? null,
        price_usd: row.price_usd ?? null,
        lot_state: row.lot_state ?? null,
        sale_confirmed: row.sale_confirmed ?? null,
        current_bid_usd: row.raw_payload?.current_bid_usd ?? null,
      };
    });

  return available;
}

export const storeImagesForRun = async (runId: string) => {
  // 1. Get all sighting IDs for the run
  const { data: listings, error } = await supabase
    .from('research_run_listings')
    .select('sighting_id')
    .eq('run_id', runId);

  if (error) throw new Error(`Failed to get run listings: ${error.message}`);
  if (!listings || listings.length === 0) return { results: [] };

  const sightingIds = listings.map(l => l.sighting_id);
  const results: any[] = [];

  // 2. Batch in chunks of 50
  for (let i = 0; i < sightingIds.length; i += 50) {
    const batch = sightingIds.slice(i, i + 50);
    const { data, error: invokeError } = await supabase.functions.invoke('store-images', {
      body: { sighting_ids: batch }
    });
    
    if (invokeError) {
      console.warn('Batch image storage failed:', invokeError);
      // We continue with other batches
    } else if (data && data.results) {
      results.push(...data.results);
    }
  }

  return { results };
};

export const getSignedImageUrls = async (paths: string[], expiresIn = 3600): Promise<{ path: string, signedUrl: string }[]> => {
  if (paths.length === 0) return [];
  
  const { data, error } = await supabase.storage
    .from('vehicle-images')
    .createSignedUrls(paths, expiresIn);

  if (error) {
    console.error(`Failed to sign URLs: ${error.message}`);
    return [];
  }

  return (data || []).filter(d => !d.error && d.signedUrl).map(d => ({
    path: d.path!,
    signedUrl: d.signedUrl
  }));
};

export const softDeleteRun = async (runId: string, userId: string): Promise<void> => {
  const { error } = await supabase
    .from('research_runs')
    .update({ 
      deleted_at: new Date().toISOString(),
      deleted_by: userId,
      share_enabled: false 
    })
    .eq('id', runId);

  if (error) {
    throw new Error(`Failed to delete research run: ${error.message}`);
  }
};

export const listDeletedRuns = async (orgId: string): Promise<ResearchRun[]> => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data, error } = await supabase
    .from('research_runs')
    .select('*, research_run_listings(count)')
    .eq('org_id', orgId)
    .not('deleted_at', 'is', null)
    .gte('deleted_at', thirtyDaysAgo.toISOString())
    .order('deleted_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list deleted runs: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    ...row,
    listing_count: row.research_run_listings?.[0]?.count || 0,
  }));
};

export const restoreRun = async (runId: string): Promise<void> => {
  const { error } = await supabase
    .from('research_runs')
    .update({ 
      deleted_at: null,
      deleted_by: null
    })
    .eq('id', runId);

  if (error) {
    throw new Error(`Failed to restore research run: ${error.message}`);
  }
};
