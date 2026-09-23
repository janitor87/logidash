import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LogisticPro2026!';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const DEFAULT_PHONE = '+380989749954';

// Very small in-memory cache. Serverless instances are short-lived and can
// be recycled at any time, so this is a best-effort speed-up for repeat
// requests hitting a warm instance - not a source of truth. The real
// "don't ask Google twice for the same pair" cache lives client-side in
// localStorage (see index.html), this just saves a few calls in between.
const distanceMemoCache = new Map();
const DISTANCE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

async function fetchDrivingDistanceKm(origin, destination) {
  const cacheKey = `${origin.toLowerCase()}__${destination.toLowerCase()}`;
  const cached = distanceMemoCache.get(cacheKey);
  if (cached && Date.now() - cached.at < DISTANCE_CACHE_TTL_MS) {
    return cached.result;
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return { error: 'no_api_key' };
  }

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?units=metric&mode=driving&origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&key=${GOOGLE_MAPS_API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) return { error: 'google_http_error' };

  const data = await res.json();
  const element = data?.rows?.[0]?.elements?.[0];

  if (data.status !== 'OK' || !element || element.status !== 'OK') {
    return { error: 'no_route', detail: element?.status || data.status };
  }

  const result = {
    km: Math.round(element.distance.value / 1000),
    durationText: element.duration?.text || null
  };
  distanceMemoCache.set(cacheKey, { result, at: Date.now() });
  return result;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getFallbackDemoData() {
  const now = new Date();
  const formatIso = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  return [
    {
      id: "demo-1",
      truck_type: "Тент 86–92м³",
      trucks_count: 2,
      product: "Шрот соєвий (біг-беги)",
      weight: "22 т / 86 м³",
      loading_location: "м. Вінниця (UA)",
      unloading_location: "м. Хелм (PL)",
      loading_date: formatIso(new Date(now.getTime() + 86400000)),
      unloading_date: formatIso(new Date(now.getTime() + 86400000 * 3)),
      payment_terms: "5 б.д. по сканах CMR",
      contact_phone: "+380989749954",
      customs_clearance_out: "Вінницька митниця",
      customs_clearance_in: "Дорогуськ (PL)",
      price: "1 250 EUR",
      notes: "Потрібно 2 авто. Верхнє/бокове завантаження.",
      status: "active",
      created_at: now.toISOString()
    },
    {
      id: "demo-2",
      truck_type: "Зерновоз (самоскид)",
      trucks_count: 3,
      product: "Кукурудза фуражна (насип)",
      weight: "24 т",
      loading_location: "м. Тернопіль (UA)",
      unloading_location: "порт Гданськ (PL)",
      loading_date: formatIso(now),
      unloading_date: formatIso(new Date(now.getTime() + 86400000 * 2)),
      payment_terms: "По вивантаженню (ТТН)",
      contact_phone: "+380989749954",
      customs_clearance_out: "Тернопільська митниця",
      customs_clearance_in: "Гданськ термінал",
      price: "42 EUR/т",
      notes: "Потрібно 3 зерновози з клапан-дверима. Прямий контракт.",
      status: "active",
      created_at: now.toISOString()
    },
    {
      id: "demo-3",
      truck_type: "Автоцистерна (харчова)",
      trucks_count: 1,
      product: "Олія соняшникова",
      weight: "22.5 т",
      loading_location: "м. Полтава (UA)",
      unloading_location: "м. Клайпеда (LT)",
      loading_date: formatIso(new Date(now.getTime() + 86400000 * 2)),
      unloading_date: formatIso(new Date(now.getTime() + 86400000 * 5)),
      payment_terms: "50% / 50% по CMR",
      contact_phone: "+380989749954",
      customs_clearance_out: "Полтава ВМО",
      customs_clearance_in: "Клайпеда порт",
      price: "Запит ціни",
      notes: "Ізотермічна цистерна з підігрівом, 3-4 секції.",
      status: "active",
      created_at: now.toISOString()
    }
  ];
}

function validateShipmentPayload(body, isUpdate = false) {
  const errors = [];
  if (isUpdate && !body.id) errors.push("ID заявки обов'язковий");
  if (!isUpdate && !body.truck_type?.trim()) errors.push("Тип авто обов'язковий");
  if (!isUpdate && !body.product?.trim()) errors.push("Назва вантажу обов'язкова");
  if (!isUpdate && !body.weight?.trim()) errors.push("Вага/об'єм обов'язкові");
  if (!isUpdate && !body.loading_location?.trim()) errors.push("Місце завантаження обов'язкове");
  if (!isUpdate && !body.unloading_location?.trim()) errors.push("Місце розвантаження обов'язкове");
  if (!isUpdate && !body.loading_date) errors.push("Дата завантаження обов'язкова");

  if (body.truck_type && body.truck_type.length > 100) errors.push("Тип авто: макс 100 символів");
  if (body.product && body.product.length > 150) errors.push("Продукт: макс 150 символів");
  if (body.weight && body.weight.length > 50) errors.push("Вага: макс 50 символів");
  if (body.loading_location && body.loading_location.length > 255) errors.push("Місце завантаження: макс 255 символів");
  if (body.unloading_location && body.unloading_location.length > 255) errors.push("Місце розвантаження: макс 255 символів");
  if (body.payment_terms && body.payment_terms.length > 150) errors.push("Оплата: макс 150 символів");
  if (body.price && body.price.length > 100) errors.push("Ціна: макс 100 символів");
  if (body.trucks_count && (isNaN(body.trucks_count) || body.trucks_count < 1 || body.trucks_count > 50)) {
    errors.push("Кількість авто повинна бути від 1 до 50");
  }

  return errors;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  const supabase = isSupabaseConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

  try {
    // 1. GET Requests
    if (req.method === 'GET') {
      const { action } = req.query;

      if (action === 'verify_admin') {
        const authHeader = req.headers.authorization;
        const providedPass = authHeader ? authHeader.replace('Bearer ', '').trim() : null;

        if (!providedPass || providedPass !== ADMIN_PASSWORD) {
          return res.status(401).json({ error: 'Невірний пароль адміністратора' });
        }
        return res.status(200).json({ ok: true, message: 'Пароль вірний' });
      }

      if (action === 'distance') {
        const { origin, destination } = req.query;
        if (!origin || !destination) {
          return res.status(400).json({ error: "Потрібні параметри origin і destination" });
        }
        const result = await fetchDrivingDistanceKm(String(origin), String(destination));
        if (result.error) {
          // Not a hard failure for the client - it just means "no real
          // route distance available", so it can fall back to its own
          // straight-line estimate instead of showing an error toast.
          return res.status(200).json({ available: false, reason: result.error });
        }
        return res.status(200).json({ available: true, km: result.km, duration: result.durationText, source: 'google' });
      }

      if (!isSupabaseConfigured) {
        res.setHeader('X-Data-Source', 'local_demo');
        return res.status(200).json(getFallbackDemoData());
      }

      // Auto-archive expired shipments
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      await supabase
        .from('shipments')
        .update({ status: 'completed' })
        .eq('status', 'active')
        .lt('loading_date', threeDaysAgo);

      const { data, error } = await supabase
        .from('shipments')
        .select('*')
        .order('loading_date', { ascending: true });

      if (error) {
        res.setHeader('X-Data-Source', 'supabase_error');
        return res.status(500).json({ error: error.message });
      }

      // If Supabase is connected, return EXACT data (even if empty []) so deleted items stay deleted!
      res.setHeader('X-Data-Source', 'supabase');
      return res.status(200).json(data || []);
    }

    // 2. Auth Verification for Mutations
    const authHeader = req.headers.authorization;
    const providedPass = authHeader ? authHeader.replace('Bearer ', '').trim() : null;

    if (!providedPass || providedPass !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Невірний пароль адміністратора' });
    }

    // 3. POST (Create)
    if (req.method === 'POST') {
      const payload = req.body || {};
      const validationErrors = validateShipmentPayload(payload, false);
      if (validationErrors.length > 0) {
        return res.status(400).json({ error: validationErrors.join('; ') });
      }

      const record = {
        truck_type: payload.truck_type.trim(),
        trucks_count: parseInt(payload.trucks_count, 10) || 1,
        product: payload.product.trim(),
        weight: payload.weight.trim(),
        loading_location: payload.loading_location.trim(),
        unloading_location: payload.unloading_location.trim(),
        loading_date: payload.loading_date,
        unloading_date: payload.unloading_date || null,
        payment_terms: payload.payment_terms?.trim() || null,
        contact_phone: payload.contact_phone?.trim() || DEFAULT_PHONE,
        customs_clearance_out: payload.customs_clearance_out?.trim() || null,
        customs_clearance_in: payload.customs_clearance_in?.trim() || null,
        price: payload.price?.trim() || null,
        status: payload.status === 'completed' ? 'completed' : 'active',
        notes: payload.notes?.trim() || null,
        created_at: new Date().toISOString()
      };

      if (!isSupabaseConfigured) {
        res.setHeader('X-Data-Source', 'local_demo');
        const newItem = { id: `local-${Date.now()}`, ...record };
        return res.status(201).json(newItem);
      }

      const { data, error } = await supabase
        .from('shipments')
        .insert([record])
        .select();

      if (error) throw error;
      res.setHeader('X-Data-Source', 'supabase');
      return res.status(201).json(data[0]);
    }

    // 4. PUT (Update)
    if (req.method === 'PUT') {
      const payload = req.body || {};
      const validationErrors = validateShipmentPayload(payload, true);
      if (validationErrors.length > 0) {
        return res.status(400).json({ error: validationErrors.join('; ') });
      }

      const { id, ...rawUpdates } = payload;
      const updates = {
        ...rawUpdates,
        updated_at: new Date().toISOString()
      };
      if (updates.trucks_count) updates.trucks_count = parseInt(updates.trucks_count, 10) || 1;

      const isUuid = UUID_REGEX.test(id);

      if (!isSupabaseConfigured || !isUuid) {
        res.setHeader('X-Data-Source', isSupabaseConfigured ? 'supabase' : 'local_demo');
        return res.status(200).json({ id, ...updates });
      }

      const { data, error } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', id)
        .select();

      if (error) throw error;
      res.setHeader('X-Data-Source', 'supabase');
      return res.status(200).json(data[0] || { id, ...updates });
    }

    // 5. DELETE
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "ID заявки обов'язковий" });

      const isUuid = UUID_REGEX.test(id);

      if (!isSupabaseConfigured || !isUuid) {
        res.setHeader('X-Data-Source', isSupabaseConfigured ? 'supabase' : 'local_demo');
        return res.status(200).json({ success: true, id });
      }

      const { error } = await supabase
        .from('shipments')
        .delete()
        .eq('id', id);

      if (error) throw error;
      res.setHeader('X-Data-Source', 'supabase');
      return res.status(200).json({ success: true, id });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Внутрішня помилка сервера' });
  }
}
