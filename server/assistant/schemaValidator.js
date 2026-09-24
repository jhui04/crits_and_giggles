/**
 * Minimal, dependency-free JSON-schema validator for the subset used by the
 * assistant tool definitions: type (string/number/integer/boolean/array/object),
 * required, enum, items, properties, minimum/maximum, minItems/maxItems.
 *
 * Lenient by design: numeric strings are coerced for number/integer fields,
 * "true"/"false" for booleans, case-insensitive enum matches are normalized,
 * null for an optional property is treated as absent, and unknown properties
 * are passed through untouched. Returns a coerced deep copy; never mutates input.
 */

function describe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function validateNode(schema, value, path, errors, opts) {
  if (!schema || typeof schema !== 'object') return value;
  const type = schema.type;
  let v = value;

  if (type === 'string') {
    // Shallow mode: write tools accept numbers/objects here (e.g. destination
    // {x,y}) and run their own domain validation; only reject clearly wrong shapes.
    const okShallow = opts.shallow && (typeof v === 'number' || (typeof v === 'object' && v !== null && !Array.isArray(v)));
    if (typeof v !== 'string' && !okShallow) {
      errors.push(`"${path}" must be a string (got ${describe(v)})`);
      return v;
    }
  } else if (type === 'number' || type === 'integer') {
    if (opts.shallow && typeof v === 'string') return v; // tool reports its own precise error
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) v = Number(v);
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`"${path}" must be ${type === 'integer' ? 'an integer' : 'a number'} (got ${describe(value)})`);
      return value;
    }
    if (type === 'integer' && !Number.isInteger(v)) {
      errors.push(`"${path}" must be an integer (got ${v})`);
      return v;
    }
    if (!opts.shallow && typeof schema.minimum === 'number' && v < schema.minimum) {
      errors.push(`"${path}" must be >= ${schema.minimum} (got ${v})`);
    }
    if (!opts.shallow && typeof schema.maximum === 'number' && v > schema.maximum) {
      errors.push(`"${path}" must be <= ${schema.maximum} (got ${v})`);
    }
  } else if (type === 'boolean') {
    if (v === 'true') v = true;
    else if (v === 'false') v = false;
    if (typeof v !== 'boolean') {
      errors.push(`"${path}" must be a boolean (got ${describe(value)})`);
      return value;
    }
  } else if (type === 'array') {
    if (!Array.isArray(v)) {
      errors.push(`"${path}" must be an array (got ${describe(v)})`);
      return v;
    }
    if (typeof schema.minItems === 'number' && v.length < schema.minItems) {
      errors.push(`"${path}" must have at least ${schema.minItems} item(s)`);
    }
    if (typeof schema.maxItems === 'number' && v.length > schema.maxItems) {
      errors.push(`"${path}" must have at most ${schema.maxItems} item(s)`);
    }
    if (schema.items && !opts.shallow) {
      return v.map((item, i) => validateNode(schema.items, item, `${path}[${i}]`, errors, opts));
    }
    return v;
  } else if (type === 'object') {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      errors.push(`"${path}" must be an object (got ${describe(v)})`);
      return v;
    }
    return opts.shallow ? v : validateObject(schema, v, path, errors, opts);
  }

  if (!opts.shallow && Array.isArray(schema.enum)) {
    if (!schema.enum.includes(v)) {
      const ci =
        typeof v === 'string'
          ? schema.enum.find((e) => typeof e === 'string' && e.toLowerCase() === v.trim().toLowerCase())
          : undefined;
      if (ci !== undefined) {
        v = ci;
      } else {
        errors.push(`"${path}" must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')} (got ${JSON.stringify(value)})`);
      }
    }
  }
  return v;
}

function validateObject(schema, obj, path, errors, opts) {
  const out = { ...obj };
  const props = schema.properties || {};
  // Treat null as "not provided" so optional fields sent as null are accepted.
  for (const key of Object.keys(out)) {
    if (out[key] === null && props[key] && !(Array.isArray(schema.required) && schema.required.includes(key))) {
      delete out[key];
    }
  }
  const prefix = path ? `${path}.` : '';
  for (const key of schema.required || []) {
    if (out[key] === undefined || (out[key] === null && !opts.shallow)) {
      errors.push(`"${prefix}${key}" is required`);
    }
  }
  for (const [key, sub] of Object.entries(props)) {
    if (out[key] === undefined || out[key] === null) continue;
    out[key] = validateNode(sub, out[key], `${prefix}${key}`, errors, opts);
  }
  return out;
}

/**
 * Validates args against a tool's parameters schema.
 * `shallow` (used for write tools, which own richer domain validation and
 * error messages): only top-level required/type shape checks, no enum/range/nested.
 * @returns {{ valid: boolean, errors: string[], args: object }} coerced args
 */
export function validateAgainstSchema(schema, args, { shallow = false } = {}) {
  const errors = [];
  const coerced = validateObject(schema || {}, args, '', errors, { shallow });
  return { valid: errors.length === 0, errors, args: coerced };
}

export function formatSchemaErrors(toolName, errors) {
  return `Invalid arguments for tool "${toolName}": ${errors.join('; ')}. Fix the arguments and call the tool again.`;
}
