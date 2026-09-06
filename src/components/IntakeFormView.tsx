import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, ChevronLeft } from 'lucide-react';
import { supabase } from '../services/supabaseClient';

// Set right before redirecting to Google, read back on the post-redirect reload so this page
// can tell "we just returned from our own account offer" apart from an unrelated session
// already sitting in the browser (e.g. a staff member who happens to open this link while
// already logged in elsewhere in the same browser) - an ambient session must never be
// mistaken for a fresh link.
const ACCOUNT_OFFER_PENDING_KEY = 'intake_account_offer_pending_token';

interface IntakeFormViewProps {
  token: string;
}

interface BriefData {
  make: string | null;
  model: string | null;
  trim: string | null;
  year_min: number | null;
  year_max: number | null;
  max_mileage: number | null;
  transmission: string | null;
  fuel_type: string | null;
  condition_required: string | null;
  titles_accepted: string[] | null;
  colour_preference: string | null;
  interior_preference: string | null;
  quantity: number | null;
  max_budget_usd: number | null;
  max_bid_usd: number | null;
  additional_notes: string | null;
  preferred_auction_sources: string[] | null;
  pickup_delivery_location: string | null;
  inspection_required: boolean | null;
  inspection_scope: string | null;
  payment_method: string | null;
  damage_tolerance_accepted: string[] | null;
  shipping_insurance_optin: boolean | null;
  consent_to_bid: boolean | null;
  consent_share_with_auction_houses: boolean | null;
}

interface ClientData {
  full_name: string | null;
  phone: string | null;
  email: string | null;
  preferred_contact: string | null;
}

type TriState = '' | 'yes' | 'no';
const boolToTri = (v: boolean | null | undefined): TriState => v === true ? 'yes' : v === false ? 'no' : '';
const triToBool = (v: TriState): boolean | null => v === 'yes' ? true : v === 'no' ? false : null;

const TITLE_OPTIONS = ['Clean', 'Salvage', 'Rebuilt', 'Certificate of Destruction'];
const DAMAGE_OPTIONS = ['Front end', 'Rear end', 'Side', 'Hail', 'Flood', 'Fire', 'Mechanical', 'Vandalism', 'None (clean only)'];
const AUCTION_SOURCE_OPTIONS = ['Copart', 'IAAI', 'Bid.cars', 'Dealer / other'];

function toggleInArray(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-8">
    <h2 className="text-base font-bold text-[#403f4c] mb-4 pb-2 border-b border-gray-200">{title}</h2>
    <div className="space-y-5">{children}</div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
    {children}
    {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
  </div>
);

const inputClass = "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#a58039] focus:border-transparent";

const TriStateButtons: React.FC<{ value: TriState; onChange: (v: TriState) => void }> = ({ value, onChange }) => (
  <div className="flex gap-2">
    {(['yes', 'no'] as const).map(opt => (
      <button
        type="button"
        key={opt}
        onClick={() => onChange(value === opt ? '' : opt)}
        className={`flex-1 py-2.5 rounded-lg text-sm font-bold border transition-colors ${
          value === opt
            ? (opt === 'yes' ? 'bg-[#403f4c] text-white border-[#403f4c]' : 'bg-gray-600 text-white border-gray-600')
            : 'bg-white text-gray-600 border-gray-300'
        }`}
      >
        {opt === 'yes' ? 'Yes' : 'No'}
      </button>
    ))}
  </div>
);

const CheckboxGroup: React.FC<{ options: string[]; selected: string[]; onToggle: (v: string) => void }> = ({ options, selected, onToggle }) => (
  <div className="flex flex-wrap gap-2">
    {options.map(opt => (
      <button
        type="button"
        key={opt}
        onClick={() => onToggle(opt)}
        className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
          selected.includes(opt) ? 'bg-[#a58039]/10 border-[#a58039] text-[#a58039] font-bold' : 'bg-white border-gray-300 text-gray-600'
        }`}
      >
        {opt}
      </button>
    ))}
  </div>
);

const IntakeFormView: React.FC<IntakeFormViewProps> = ({ token }) => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [step, setStep] = useState<'form' | 'review' | 'success' | 'account-linked'>('form');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [accountOfferBusy, setAccountOfferBusy] = useState(false);
  const [accountOfferError, setAccountOfferError] = useState<string | null>(null);
  const [accountOfferDismissed, setAccountOfferDismissed] = useState(false);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [preferredContact, setPreferredContact] = useState('');

  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [trim, setTrim] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [maxMileage, setMaxMileage] = useState('');
  const [transmission, setTransmission] = useState('');
  const [fuelType, setFuelType] = useState('');
  const [conditionRequired, setConditionRequired] = useState('');
  const [titlesAccepted, setTitlesAccepted] = useState<string[]>([]);
  const [colourPreference, setColourPreference] = useState('');
  const [interiorPreference, setInteriorPreference] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [maxBudgetUsd, setMaxBudgetUsd] = useState('');
  const [maxBidUsd, setMaxBidUsd] = useState('');
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [preferredAuctionSources, setPreferredAuctionSources] = useState<string[]>([]);
  const [pickupDeliveryLocation, setPickupDeliveryLocation] = useState('');
  const [inspectionRequired, setInspectionRequired] = useState<TriState>('');
  const [inspectionScope, setInspectionScope] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [damageToleranceAccepted, setDamageToleranceAccepted] = useState<string[]>([]);
  const [shippingInsuranceOptin, setShippingInsuranceOptin] = useState<TriState>('');
  const [consentToBid, setConsentToBid] = useState<TriState>('');
  const [consentShare, setConsentShare] = useState<TriState>('');

  useEffect(() => {
    const checkAccountOfferReturn = async () => {
      const pendingToken = sessionStorage.getItem(ACCOUNT_OFFER_PENDING_KEY);
      if (pendingToken !== token) return false;
      const { data } = await supabase.auth.getSession();
      sessionStorage.removeItem(ACCOUNT_OFFER_PENDING_KEY);
      if (data.session) {
        setStep('account-linked');
        setLoading(false);
        return true;
      }
      return false;
    };

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const justLinked = await checkAccountOfferReturn();
        if (justLinked) return;
        const baseUrl = import.meta.env.VITE_SUPABASE_URL;
        const res = await fetch(`${baseUrl}/functions/v1/intake-brief?token=${token}`);
        if (!res.ok) {
          if (res.status === 404) {
            throw new Error("This link is no longer available. Please contact Caplimo for an updated link.");
          }
          throw new Error("Failed to load this form.");
        }
        const json = await res.json();
        const b: BriefData = json.brief;
        setClientName(json.client_name || null);
        const client: ClientData | null = json.client;
        setFullName(client?.full_name || '');
        setPhone(client?.phone || '');
        setEmail(client?.email || '');
        setPreferredContact(client?.preferred_contact || '');
        setMake(b.make || '');
        setModel(b.model || '');
        setTrim(b.trim || '');
        setYearFrom(b.year_min != null ? String(b.year_min) : '');
        setYearTo(b.year_max != null ? String(b.year_max) : '');
        setMaxMileage(b.max_mileage != null ? String(b.max_mileage) : '');
        setTransmission(b.transmission || '');
        setFuelType(b.fuel_type || '');
        setConditionRequired(b.condition_required || '');
        setTitlesAccepted(b.titles_accepted || []);
        setColourPreference(b.colour_preference || '');
        setInteriorPreference(b.interior_preference || '');
        setQuantity(b.quantity != null ? String(b.quantity) : '1');
        setMaxBudgetUsd(b.max_budget_usd != null ? String(b.max_budget_usd) : '');
        setMaxBidUsd(b.max_bid_usd != null ? String(b.max_bid_usd) : '');
        setAdditionalNotes(b.additional_notes || '');
        setPreferredAuctionSources(b.preferred_auction_sources || []);
        setPickupDeliveryLocation(b.pickup_delivery_location || '');
        setInspectionRequired(boolToTri(b.inspection_required));
        setInspectionScope(b.inspection_scope || '');
        setPaymentMethod(b.payment_method || '');
        setDamageToleranceAccepted(b.damage_tolerance_accepted || []);
        setShippingInsuranceOptin(boolToTri(b.shipping_insurance_optin));
        setConsentToBid(boolToTri(b.consent_to_bid));
        setConsentShare(boolToTri(b.consent_share_with_auction_houses));
      } catch (err: any) {
        setLoadError(err.message || 'An unexpected error occurred.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token]);

  const buildPayload = () => ({
    token,
    full_name: fullName.trim() || null,
    phone: phone.trim() || null,
    email: email.trim() || null,
    preferred_contact: preferredContact || null,
    make: make.trim() || null,
    model: model.trim() || null,
    trim: trim.trim() || null,
    year_min: yearFrom ? parseInt(yearFrom, 10) : null,
    year_max: yearTo ? parseInt(yearTo, 10) : null,
    max_mileage: maxMileage ? parseInt(maxMileage, 10) : null,
    transmission: transmission || null,
    fuel_type: fuelType || null,
    condition_required: conditionRequired || null,
    titles_accepted: titlesAccepted.length ? titlesAccepted : null,
    colour_preference: colourPreference.trim() || null,
    interior_preference: interiorPreference.trim() || null,
    quantity: quantity ? parseInt(quantity, 10) : 1,
    max_budget_usd: maxBudgetUsd ? parseFloat(maxBudgetUsd) : null,
    max_bid_usd: maxBidUsd ? parseFloat(maxBidUsd) : null,
    additional_notes: additionalNotes.trim() || null,
    preferred_auction_sources: preferredAuctionSources.length ? preferredAuctionSources : null,
    pickup_delivery_location: pickupDeliveryLocation.trim() || null,
    inspection_required: triToBool(inspectionRequired),
    inspection_scope: inspectionScope.trim() || null,
    payment_method: paymentMethod.trim() || null,
    damage_tolerance_accepted: damageToleranceAccepted.length ? damageToleranceAccepted : null,
    shipping_insurance_optin: triToBool(shippingInsuranceOptin),
    consent_to_bid: triToBool(consentToBid),
    consent_share_with_auction_houses: triToBool(consentShare),
  });

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const baseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${baseUrl}/functions/v1/intake-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Could not submit the form. Please try again.');
      }
      setStep('success');
    } catch (err: any) {
      setSubmitError(err.message || 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F0EDDE] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#a58039]" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#F0EDDE] flex items-center justify-center p-6">
        <div className="max-w-sm text-center bg-white p-8 rounded-xl shadow-sm">
          <p className="text-gray-700">{loadError}</p>
        </div>
      </div>
    );
  }

  const handleGoogleAccountOffer = async () => {
    setAccountOfferBusy(true);
    setAccountOfferError(null);
    try {
      sessionStorage.setItem(ACCOUNT_OFFER_PENDING_KEY, token);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.href },
      });
      if (error) throw error;
      // Browser navigates away to Google here; nothing more to do on this page load.
    } catch (err: any) {
      sessionStorage.removeItem(ACCOUNT_OFFER_PENDING_KEY);
      setAccountOfferError(err.message || 'Could not start sign-in. Please try again.');
      setAccountOfferBusy(false);
    }
  };

  if (step === 'account-linked') {
    return (
      <div className="min-h-screen bg-[#F0EDDE] flex items-center justify-center p-6">
        <div className="max-w-sm text-center bg-white p-8 rounded-xl shadow-sm">
          <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-4" />
          <h1 className="text-lg font-bold text-[#403f4c] mb-2">You're signed in</h1>
          <p className="text-sm text-gray-600">
            Your account is now linked to your existing request with Caplimo. There's nothing
            further to do here for now — we'll be in touch as your request moves forward.
          </p>
        </div>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="min-h-screen bg-[#F0EDDE] flex items-center justify-center p-6">
        <div className="max-w-sm text-center bg-white p-8 rounded-xl shadow-sm">
          <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-4" />
          <h1 className="text-lg font-bold text-[#403f4c] mb-2">Submitted</h1>
          <p className="text-sm text-gray-600">
            Thank you{clientName ? `, ${clientName}` : ''}. We've received your requirements and
            a member of our team will review them shortly. A copy has been sent to your email on
            file, if one is on record.
          </p>

          {!accountOfferDismissed && (
            <div className="mt-6 pt-6 border-t border-gray-100 text-left">
              <p className="text-sm font-bold text-[#403f4c] mb-1">Create an account to track your request</p>
              <p className="text-xs text-gray-500 mb-3">
                Optional. If you skip this, your request is already saved — nothing is lost.
              </p>
              {accountOfferError && <p className="text-xs text-red-600 mb-2">{accountOfferError}</p>}
              <button
                onClick={handleGoogleAccountOffer}
                disabled={accountOfferBusy}
                className="w-full py-2.5 bg-white border border-gray-300 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 mb-2"
              >
                {accountOfferBusy ? 'Redirecting...' : 'Continue with Google'}
              </button>
              <button
                onClick={() => setAccountOfferDismissed(true)}
                className="w-full py-1 text-xs text-gray-400 hover:text-gray-600"
              >
                Maybe later
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const NdprNotice = () => (
    <div className="bg-[#403f4c]/5 border border-[#403f4c]/15 rounded-lg p-4 text-xs text-gray-600 mb-6">
      We use the details below only to source and evaluate vehicles on your behalf. Your
      information is kept confidential and is not shared outside Caplimo except where you
      separately consent below.
    </div>
  );

  if (step === 'review') {
    const p = buildPayload();
    const rows: [string, string][] = [
      ['Full name', p.full_name || '—'], ['Mobile / WhatsApp', p.phone || '—'], ['Email', p.email || '—'],
      ['Preferred contact', p.preferred_contact || 'No preference'],
      ['Make', p.make || '—'], ['Model', p.model || '—'], ['Trim', p.trim || '—'],
      ['Year range', `${p.year_min ?? 'Any'} - ${p.year_max ?? 'Any'}`],
      ['Max mileage', p.max_mileage != null ? `${p.max_mileage.toLocaleString()} mi` : 'No preference'],
      ['Transmission', p.transmission || 'No preference'],
      ['Fuel type', p.fuel_type || 'No preference'],
      ['Condition', p.condition_required || 'No preference'],
      ['Titles accepted', p.titles_accepted?.join(', ') || 'No preference'],
      ['Damage tolerance', p.damage_tolerance_accepted?.join(', ') || 'No preference'],
      ['Colour preference', p.colour_preference || 'No preference'],
      ['Interior preference', p.interior_preference || 'No preference'],
      ['Quantity', String(p.quantity)],
      ['Max budget (USD)', p.max_budget_usd != null ? `$${p.max_budget_usd.toLocaleString()}` : 'No preference'],
      ['Max bid (USD)', p.max_bid_usd != null ? `$${p.max_bid_usd.toLocaleString()}` : 'No preference'],
      ['Preferred auction sources', p.preferred_auction_sources?.join(', ') || 'No preference'],
      ['Pickup / delivery location', p.pickup_delivery_location || '—'],
      ['Inspection required', p.inspection_required == null ? 'Not answered' : (p.inspection_required ? 'Yes' : 'No')],
      ['Inspection scope', p.inspection_scope || '—'],
      ['Payment method', p.payment_method || '—'],
      ['Shipping insurance', p.shipping_insurance_optin == null ? 'Not answered' : (p.shipping_insurance_optin ? 'Yes' : 'No')],
      ['Additional notes', p.additional_notes || '—'],
      ['Consent to bid on your behalf', p.consent_to_bid == null ? 'Not answered' : (p.consent_to_bid ? 'Yes' : 'No')],
      ['Consent to share details with auction houses', p.consent_share_with_auction_houses == null ? 'Not answered' : (p.consent_share_with_auction_houses ? 'Yes' : 'No')],
    ];
    return (
      <div className="min-h-screen bg-[#F0EDDE] py-8 px-4">
        <div className="max-w-lg mx-auto bg-white rounded-xl shadow-sm p-6">
          <button onClick={() => setStep('form')} className="flex items-center gap-1 text-sm font-bold text-[#a58039] mb-4">
            <ChevronLeft className="w-4 h-4" /> Back and edit
          </button>
          <h1 className="text-lg font-bold text-[#403f4c] mb-4">Review before submitting</h1>
          <div className="space-y-3 mb-6">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 text-sm border-b border-gray-100 pb-2">
                <span className="text-gray-500">{label}</span>
                <span className="text-right font-medium text-gray-800">{value}</span>
              </div>
            ))}
          </div>
          <NdprNotice />
          {submitError && <p className="text-sm text-red-600 mb-3">{submitError}</p>}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-3 bg-[#403f4c] text-white rounded-lg font-bold disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0EDDE] py-8 px-4">
      <div className="max-w-lg mx-auto bg-white rounded-xl shadow-sm p-6">
        <h1 className="text-lg font-bold text-[#403f4c] mb-1">
          {clientName ? `Vehicle requirements for ${clientName}` : 'Vehicle requirements'}
        </h1>
        <p className="text-sm text-gray-500 mb-6">Tell us what you're looking for. Every field below is optional except where marked.</p>

        <NdprNotice />

        <form onSubmit={(e) => { e.preventDefault(); setStep('review'); }}>
          <Section title="Your details">
            <Field label="Full name">
              <input className={inputClass} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your full name" autoComplete="name" />
            </Field>
            <Field label="Mobile / WhatsApp number">
              <input className={inputClass} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. +234 803 000 0000" autoComplete="tel" />
            </Field>
            <Field label="Email">
              <input className={inputClass} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
            </Field>
            <Field label="Preferred contact method">
              <select className={inputClass} value={preferredContact} onChange={e => setPreferredContact(e.target.value)} autoComplete="off">
                <option value="">No preference</option>
                <option value="phone">Phone</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
              </select>
            </Field>
          </Section>

          <Section title="Vehicle">
            <Field label="Make"><input className={inputClass} value={make} onChange={e => setMake(e.target.value)} placeholder="e.g. Toyota" /></Field>
            <Field label="Model"><input className={inputClass} value={model} onChange={e => setModel(e.target.value)} placeholder="e.g. Camry" /></Field>
            <Field label="Trim"><input className={inputClass} value={trim} onChange={e => setTrim(e.target.value)} placeholder="e.g. SE, XLE" /></Field>
            <Field label="Year range" hint="Looking for one specific year? Enter it as both from and to.">
              <div className="flex items-center gap-2">
                <input className={inputClass} type="number" value={yearFrom} onChange={e => setYearFrom(e.target.value)} placeholder="From" />
                <span className="text-gray-400">–</span>
                <input className={inputClass} type="number" value={yearTo} onChange={e => setYearTo(e.target.value)} placeholder="To" />
              </div>
            </Field>
            <Field label="Quantity needed">
              <input className={inputClass} type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} />
            </Field>
          </Section>

          <Section title="Condition and title">
            <Field label="Max mileage"><input className={inputClass} type="number" value={maxMileage} onChange={e => setMaxMileage(e.target.value)} placeholder="e.g. 100000" /></Field>
            <Field label="Condition required">
              <select className={inputClass} value={conditionRequired} onChange={e => setConditionRequired(e.target.value)}>
                <option value="">No preference</option>
                <option value="run_and_drive">Run and drive</option>
                <option value="starts_needs_work">Starts, needs work</option>
                <option value="non_running">Non-running</option>
                <option value="salvage_only">Salvage only</option>
              </select>
            </Field>
            <Field label="Transmission">
              <select className={inputClass} value={transmission} onChange={e => setTransmission(e.target.value)}>
                <option value="">No preference</option>
                <option value="automatic">Automatic</option>
                <option value="manual">Manual</option>
              </select>
            </Field>
            <Field label="Fuel type">
              <select className={inputClass} value={fuelType} onChange={e => setFuelType(e.target.value)}>
                <option value="">No preference</option>
                <option value="petrol">Petrol</option>
                <option value="diesel">Diesel</option>
                <option value="hybrid">Hybrid</option>
                <option value="electric">Electric</option>
              </select>
            </Field>
            <Field label="Titles accepted"><CheckboxGroup options={TITLE_OPTIONS} selected={titlesAccepted} onToggle={(v) => setTitlesAccepted(toggleInArray(titlesAccepted, v))} /></Field>
            <Field label="Damage you would accept" hint="Select all that apply."><CheckboxGroup options={DAMAGE_OPTIONS} selected={damageToleranceAccepted} onToggle={(v) => setDamageToleranceAccepted(toggleInArray(damageToleranceAccepted, v))} /></Field>
          </Section>

          <Section title="Preferences">
            <Field label="Exterior colour preference"><input className={inputClass} value={colourPreference} onChange={e => setColourPreference(e.target.value)} placeholder="e.g. Black, White" /></Field>
            <Field label="Interior preference"><input className={inputClass} value={interiorPreference} onChange={e => setInteriorPreference(e.target.value)} placeholder="e.g. Leather, Black" /></Field>
            <Field label="Preferred auction sources"><CheckboxGroup options={AUCTION_SOURCE_OPTIONS} selected={preferredAuctionSources} onToggle={(v) => setPreferredAuctionSources(toggleInArray(preferredAuctionSources, v))} /></Field>
          </Section>

          <Section title="Budget">
            <Field label="Max budget (USD)" hint="Total landed cost you're comfortable with."><input className={inputClass} type="number" value={maxBudgetUsd} onChange={e => setMaxBudgetUsd(e.target.value)} placeholder="e.g. 15000" /></Field>
            <Field label="Max bid (USD)" hint="Ceiling for the auction bid itself."><input className={inputClass} type="number" value={maxBidUsd} onChange={e => setMaxBidUsd(e.target.value)} placeholder="e.g. 12000" /></Field>
          </Section>

          <Section title="Logistics">
            <Field label="Pickup / delivery location"><input className={inputClass} value={pickupDeliveryLocation} onChange={e => setPickupDeliveryLocation(e.target.value)} placeholder="City, state" /></Field>
            <Field label="Inspection required before purchase?"><TriStateButtons value={inspectionRequired} onChange={setInspectionRequired} /></Field>
            {inspectionRequired === 'yes' && (
              <Field label="Describe inspection scope (if required)"><textarea className={inputClass} rows={2} value={inspectionScope} onChange={e => setInspectionScope(e.target.value)} /></Field>
            )}
            <Field label="Payment method"><input className={inputClass} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} placeholder="e.g. Bank transfer" /></Field>
            <Field label="Shipping insurance"><TriStateButtons value={shippingInsuranceOptin} onChange={setShippingInsuranceOptin} /></Field>
          </Section>

          <Section title="Additional notes">
            <textarea className={inputClass} rows={3} value={additionalNotes} onChange={e => setAdditionalNotes(e.target.value)} placeholder="Anything else we should know" />
          </Section>

          <Section title="Consent">
            <Field label="Do you consent to Caplimo bidding on your behalf within the limits above?"><TriStateButtons value={consentToBid} onChange={setConsentToBid} /></Field>
            <Field label="Do you consent to your details being shared with auction houses as part of the purchase process?"><TriStateButtons value={consentShare} onChange={setConsentShare} /></Field>
          </Section>

          <button type="submit" className="w-full py-3 bg-[#403f4c] text-white rounded-lg font-bold mt-2">
            Review before submitting
          </button>
        </form>
      </div>
    </div>
  );
};

export default IntakeFormView;
