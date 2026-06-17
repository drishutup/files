'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { format, parse } from 'date-fns';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { MultiSelect } from 'primereact/multiselect';
import { Checkbox } from 'primereact/checkbox';
import { RadioButton } from 'primereact/radiobutton';
import { Calendar } from 'primereact/calendar';
import { Tooltip } from 'primereact/tooltip';
import apiClient from '@/lib/api-client';
import { evaluateFormulaSync, preloadMathjs } from '@/utils/formulaEngine';
import {
    buildDefaultValuesForFields,
    isAadhaarVerhoeffEnabled,
    isValidAadhaarNumber,
} from '@/utils/formFieldRuntime';
import { useServicePlugin } from '@/service-plugins/_loader';
import { useAuthStore } from '@/store/authStore';
import { FormPreview } from './FormPreview';
import { ImportDoctorNurseModal } from './ImportDoctorNurseModal';
import {
    convertCSVRowToFieldValues,
    buildFieldInfoMap,
    DOCTOR_FIELD_MAPPING,
    NURSE_FIELD_MAPPING,
    type ImportType,
} from '@/utils/csvImportUtils';

const BOOTSTRAP_SPANS: Record<number, string> = { 1: "col-md-1", 2: "col-md-2", 3: "col-md-3", 4: "col-md-4", 5: "col-md-5", 6: "col-md-6", 7: "col-md-7", 8: "col-md-8", 9: "col-md-9", 10: "col-md-10", 11: "col-md-11", 12: "col-md-12" };

const ACTION_BUTTON_STYLES: Record<string, { bg: string; border: string }> = {
    APPROVE: { bg: '#16a34a', border: '#15803d' },
    SUBMIT: { bg: '#2563eb', border: '#1d4ed8' },
    SUBMIT_REPORT: { bg: '#2563eb', border: '#1d4ed8' },
    SUBMIT_TO_NODAL: { bg: '#2563eb', border: '#1d4ed8' },
    FORWARD: { bg: '#2563eb', border: '#1d4ed8' },
    FORWARD_TO_APPROVER: { bg: '#2563eb', border: '#1d4ed8' },
    FORWARD_TO_DEPARTMENT: { bg: '#2563eb', border: '#1d4ed8' },
    REJECT: { bg: '#dc2626', border: '#b91c1c' },
    REVERT_TO_APPLICANT: { bg: '#ea580c', border: '#c2410c' },
    REVERT_TO_INVESTOR: { bg: '#ea580c', border: '#c2410c' },
    REVERT_TO_NODAL: { bg: '#ea580c', border: '#c2410c' },
    QUERY: { bg: '#d97706', border: '#b45309' },
    SAVE_DRAFT: { bg: '#64748b', border: '#475569' },
    HOLD: { bg: '#64748b', border: '#475569' },
};

type Props = {
    config: any;
    serviceId?: string;
    enablePreview?: boolean;
    submissionId?: number;
    onSubmit?: (values: any, addMoreValues: any, repeatablePageValues?: any) => void;
    onSaveNext?: (payload: {
        values: any;
        addMoreValues: any;
        repeatablePageValues?: any;
        currentPageIndex: number;
        nextPageIndex: number;
    }) => Promise<boolean | void> | boolean | void;
    onCancel: () => void;
    isSubmitting?: boolean;
    initialData?: { fields: Record<string, any>; addMore: Record<number, any[]>; repeatablePages?: Record<number, any[]> };
    initialPageIndex?: number;
    readOnly?: boolean;
    finalActionLabel?: string;
    onActionButton?: (actionCode: string) => void;
    onEnsureSubmissionId?: (payload: {
        values: any;
        addMoreValues: any;
        repeatablePageValues?: any;
        currentPageIndex: number;
    }) => Promise<number | null | undefined> | number | null | undefined;
};

type FieldOverrides = {
    required?: boolean;
    visible?: boolean;
    readonly?: boolean;
    editable?: boolean;
};

type ConditionalAnyOfRule = {
    fields: string[];
    when?: any;
    message?: string;
};

type AddMoreRowRule = {
    id: number;
    targetGroupId: number;
    sourceField: string;
    mode: 'exact' | 'min' | 'max';
    applyOn: Array<'add' | 'page_save' | 'submit'>;
    message?: string;
    when?: any;
};

function isEmptyValue(v: any) {
    if (v === null || v === undefined) return true;
    if (typeof v === 'string') return v.trim().length === 0;
    if (Array.isArray(v)) return v.length === 0;
    return false;
}

// Helper to parse dates in multiple formats
function parseDateValue(value: any): Date | null {
    if (!value) return null;

    const valueStr = String(value).trim();

    // Try ISO format first (2026-04-12)
    if (valueStr.includes('-') && valueStr.length === 10) {
        try {
            const result = new Date(valueStr);
            if (!isNaN(result.getTime())) {
                return result;
            }
        } catch (e) {
            // Fall through to next format
        }
    }

    // Try DD/MM/YYYY format
    try {
        return parse(valueStr, 'dd/MM/yyyy', new Date());
    } catch (e) {
        // Fall through to next format
    }

    // Try MM/DD/YYYY format
    try {
        return parse(valueStr, 'MM/dd/yyyy', new Date());
    } catch (e) {
        // Fall through to next format
    }

    // Fallback: try JavaScript's Date constructor
    try {
        const result = new Date(valueStr);
        if (!isNaN(result.getTime())) {
            return result;
        }
    } catch (e) {
        // Do nothing
    }

    return null;
}

function allowsFutureDate(rules: unknown) {
    const ruleMap = rules && typeof rules === 'object' ? rules as Record<string, unknown> : {};
    const raw = ruleMap.allow_future_date ?? ruleMap.allowFutureDate;
    if (raw === undefined || raw === null || raw === '') return true;
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw !== 0;
    return !['false', '0', 'n', 'no'].includes(String(raw).trim().toLowerCase());
}

function allowsPreviousDate(rules: unknown) {
    const ruleMap = rules && typeof rules === 'object' ? rules as Record<string, unknown> : {};
    const raw = ruleMap.allow_previous_date ?? ruleMap.allowPreviousDate;
    if (raw === undefined || raw === null || raw === '') return true;
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw !== 0;
    return !['false', '0', 'n', 'no'].includes(String(raw).trim().toLowerCase());
}

function getDateValidationBounds(inputType: string, rules: unknown) {
    const now = new Date();
    const isDateOnly = inputType === 'date';
    const minDate = allowsPreviousDate(rules)
        ? undefined
        : (() => {
            const date = new Date(now);
            if (isDateOnly) date.setHours(0, 0, 0, 0);
            return date;
        })();
    const maxDate = allowsFutureDate(rules)
        ? undefined
        : (() => {
            const date = new Date(now);
            if (isDateOnly) date.setHours(23, 59, 59, 999);
            return date;
        })();

    return { minDate, maxDate };
}

function getProjectRegistrationDateBounds(fieldCode: string, values: Record<string, any>) {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (fieldCode === 'UK-FCL-03894_0') {
        return { maxDate: today };
    }

    if (fieldCode !== 'UK-FCL-03895_0') return {};

    const startValue = values?.['UK-FCL-03894_0'];
    if (!startValue) return { maxDate: today };

    const startDate = parseDateValue(startValue);
    if (!startDate || Number.isNaN(startDate.getTime())) return { maxDate: today };

    return { minDate: startDate, maxDate: today };
}

function isFutureDateValue(value: unknown, inputType: string) {
    if (isEmptyValue(value)) return false;
    if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return false;
    const date = value instanceof Date ? value : parseDateValue(value);
    if (!date || Number.isNaN(date.getTime())) return false;

    if (inputType === 'date') {
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        return date.getTime() > today.getTime();
    }

    return date.getTime() > Date.now();
}

function isPreviousDateValue(value: unknown, inputType: string) {
    if (isEmptyValue(value)) return false;
    if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return false;
    const date = value instanceof Date ? value : parseDateValue(value);
    if (!date || Number.isNaN(date.getTime())) return false;

    if (inputType === 'date') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return date.getTime() < today.getTime();
    }

    return date.getTime() < Date.now();
}

const EXTENSION_ALIASES: Record<string, string[]> = {
    '.jpg': ['.jpg', '.jpeg'],
    '.jpeg': ['.jpg', '.jpeg'],
    '.tif': ['.tif', '.tiff'],
    '.tiff': ['.tif', '.tiff'],
    '.htm': ['.htm', '.html'],
    '.html': ['.htm', '.html'],
};

function normalizeAllowedFormats(allowedFormats: any): string[] {
    const raw = Array.isArray(allowedFormats) ? allowedFormats : [];
    const normalized = raw
        .map((item: any) => String(item || '').trim().toLowerCase())
        .filter(Boolean)
        .map((item: string) => (item.startsWith('.') ? item : `.${item}`));
    const expanded = new Set<string>();
    normalized.forEach((ext) => {
        expanded.add(ext);
        (EXTENSION_ALIASES[ext] || []).forEach((alias) => expanded.add(alias));
    });
    return Array.from(expanded);
}

function getFileExt(fileName?: string): string {
    const name = String(fileName || '');
    const idx = name.lastIndexOf('.');
    if (idx < 0) return '';
    return name.substring(idx).toLowerCase();
}

function getStoredFilePath(value: any): string {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    return String(value.filePath || value.file_path || value.path || '').trim();
}

function getStoredFileName(value: any): string {
    if (!value) return '';
    if (value instanceof File) return value.name;
    if (typeof value === 'string') return value.split('/').pop() || value;
    return String(
        value.originalName ||
        value.original_name ||
        value.fileName ||
        value.file_name ||
        getStoredFilePath(value).split('/').pop() ||
        '',
    ).trim();
}

function safeParseJSON(input: any) {
    if (typeof input === 'string') { try { return JSON.parse(input); } catch { return null; } }
    return input;
}

function getByPath(source: any, path?: string): any {
    if (!path) return source;
    const clean = String(path || '').trim();
    if (!clean) return source;
    return clean.split('.').reduce((acc: any, key: string) => {
        if (acc === null || acc === undefined) return undefined;
        return acc[key];
    }, source);
}

function resolveTextApiConfig(field: any) {
    const componentProps = safeParseJSON(field?.component_props) || {};
    const validation = safeParseJSON(field?.validation_rule) || {};

    const direct =
        componentProps?.textApi ||
        componentProps?.text_api ||
        componentProps?.autoFetch ||
        componentProps?.autofill ||
        componentProps?.prefill ||
        null;

    const apiUrl =
        direct?.apiUrl ??
        direct?.api_url ??
        componentProps?.apiUrl ??
        componentProps?.api_url ??
        validation?.apiUrl ??
        validation?.api_url ??
        null;

    if (!apiUrl) return null;

    return {
        apiUrl: String(apiUrl),
        method: String(
            direct?.method ??
            componentProps?.method ??
            validation?.method ??
            'GET',
        ).toUpperCase(),
        responsePath: String(
            direct?.responsePath ??
            direct?.response_path ??
            componentProps?.responsePath ??
            componentProps?.response_path ??
            validation?.responsePath ??
            validation?.response_path ??
            '',
        ),
        valueKey: String(
            direct?.valueKey ??
            direct?.value_key ??
            componentProps?.valueKey ??
            componentProps?.value_key ??
            validation?.valueKey ??
            validation?.value_key ??
            '',
        ),
        triggerField: String(
            direct?.triggerField ??
            direct?.trigger_field ??
            componentProps?.triggerField ??
            componentProps?.trigger_field ??
            validation?.triggerField ??
            validation?.trigger_field ??
            '',
        ),
        paramsFromFields:
            direct?.paramsFromFields ??
            direct?.params_from_fields ??
            componentProps?.paramsFromFields ??
            componentProps?.params_from_fields ??
            validation?.paramsFromFields ??
            validation?.params_from_fields ??
            {},
        overwrite:
            Boolean(
                direct?.overwrite ??
                componentProps?.overwrite ??
                validation?.overwrite ??
                false,
            ),
        mappings:
            direct?.mappings ??
            direct?.responseMappings ??
            direct?.response_mappings ??
            componentProps?.mappings ??
            componentProps?.responseMappings ??
            componentProps?.response_mappings ??
            validation?.mappings ??
            [],
    };
}

function normalizeThenActions(
    thenJson: any,
    resolveFieldCode: (ref: any) => string | null,
): Array<{ field: string; prop: keyof FieldOverrides; value: boolean }> {
    const actions: Array<{ field: string; prop: keyof FieldOverrides; value: boolean }> = [];
    const parsed = safeParseJSON(thenJson);
    if (!parsed || typeof parsed !== 'object') return actions;

    const pushSet = (fieldRef: any, set: any) => {
        const code = resolveFieldCode(fieldRef);
        if (!code || !set || typeof set !== 'object') return;
        for (const [k, v] of Object.entries(set)) {
            if (['required', 'visible', 'readonly', 'editable'].includes(k) && typeof v === 'boolean') {
                actions.push({ field: code, prop: k as keyof FieldOverrides, value: v });
            }
        }
    };

    const toBool = (v: any): boolean | null => {
        if (typeof v === 'boolean') return v;
        if (typeof v === 'string') {
            const s = v.trim().toLowerCase();
            if (s === 'true' || s === '1' || s === 'y' || s === 'yes') return true;
            if (s === 'false' || s === '0' || s === 'n' || s === 'no') return false;
        }
        if (typeof v === 'number') {
            if (v === 1) return true;
            if (v === 0) return false;
        }
        return null;
    };

    const toProp = (action: any): keyof FieldOverrides | null => {
        const raw = String(action ?? '').trim().toLowerCase();
        if (!raw) return null;
        if (raw === 'visible' || raw === 'show' || raw === 'hide') return 'visible';
        if (raw === 'required' || raw === 'mandatory' || raw === 'optional') return 'required';
        if (raw === 'readonly' || raw === 'read_only' || raw === 'read-only' || raw === 'disable' || raw === 'disabled') return 'readonly';
        if (raw === 'editable' || raw === 'enable') return 'editable';
        return null;
    };

    if (Array.isArray(parsed.actions)) {
        for (const a of parsed.actions) {
            if (a?.targetField && a?.action !== undefined) {
                const prop = toProp(a.action);
                const val = toBool(a?.value);
                if (prop && val !== null) {
                    actions.push({ field: String(a.targetField), prop, value: val });
                    continue;
                }
                if (prop === 'visible') {
                    if (String(a.action).toLowerCase() === 'hide') actions.push({ field: String(a.targetField), prop: 'visible', value: false });
                    if (String(a.action).toLowerCase() === 'show') actions.push({ field: String(a.targetField), prop: 'visible', value: true });
                    continue;
                }
                if (prop === 'required') {
                    if (String(a.action).toLowerCase() === 'optional') actions.push({ field: String(a.targetField), prop: 'required', value: false });
                    continue;
                }
            } else {
                pushSet(a?.field ?? a?.targetField ?? a?.builderFieldId ?? a?.targetBuilderFieldId, a?.set);
            }
        }
    }

    if (parsed.set && typeof parsed.set === 'object') {
        for (const [field, patch] of Object.entries(parsed.set)) {
            pushSet(field, patch);
        }
    }

    return actions;
}

function evalConditionTree(
    tree: any,
    values: Record<string, any>,
    resolveFieldCode: (ref: any) => string | null,
): boolean {
    if (!tree || typeof tree !== 'object') return false;
    if (Array.isArray(tree.all)) return tree.all.every((c: any) => evalConditionTree(c, values, resolveFieldCode));
    if (Array.isArray(tree.any)) return tree.any.some((c: any) => evalConditionTree(c, values, resolveFieldCode));

    const fieldRef = tree.field ?? tree.field_code ?? tree.left ?? tree.builderFieldId ?? tree.fieldId;
    const op = String(tree.operator ?? tree.op ?? 'equals').toLowerCase();
    const rhs = tree.value ?? tree.right;
    const normalizeList = (input: any): any[] => {
        if (Array.isArray(input)) return input;
        if (typeof input === 'string') {
            return input
                .split(',')
                .map((v) => v.trim())
                .filter((v) => v.length > 0);
        }
        return [input];
    };
    const normalizeToken = (v: any): string => {
        const s = String(v ?? '').trim();
        if (!s) return '';
        const n = Number(s);
        if (Number.isFinite(n)) return String(n);
        return s.toLowerCase();
    };
    const fieldCode = resolveFieldCode(fieldRef);
    if (!fieldCode) return false;
    const lhs = values[fieldCode];

    switch (op) {
        case 'equals':
        case 'eq':
            return String(lhs) == String(rhs);
        case 'not_equals':
        case 'neq':
            return String(lhs) != String(rhs);
        case 'in': {
            const rhsArr = normalizeList(rhs).map((v) => normalizeToken(v));
            const lhsArr = Array.isArray(lhs) ? lhs : (lhs ? [lhs] : []);
            return lhsArr.some((x: any) => rhsArr.includes(normalizeToken(x)));
        }
        case 'not_in': {
            const rhsArr = normalizeList(rhs).map((v) => normalizeToken(v));
            const lhsArr = Array.isArray(lhs) ? lhs : (lhs ? [lhs] : []);
            return lhsArr.every((x: any) => !rhsArr.includes(normalizeToken(x)));
        }
        case 'contains': {
            const rhsArr = normalizeList(rhs).map((v) => normalizeToken(v));
            if (typeof lhs === 'string') {
                const leftNorm = normalizeToken(lhs);
                return rhsArr.some((v) => leftNorm.includes(v));
            }
            const lhsArr = Array.isArray(lhs) ? lhs : (lhs ? [lhs] : []);
            return lhsArr.some((x: any) => rhsArr.includes(normalizeToken(x)));
        }
        case 'greater_than':
        case 'gt':
            return Number(lhs) > Number(rhs);
        case 'less_than':
        case 'lt':
            return Number(lhs) < Number(rhs);
        case 'is_empty':
            return isEmptyValue(lhs);
        case 'is_not_empty':
            return !isEmptyValue(lhs);
        default:
            return false;
    }
}

function buildConditionalAnyOfRules(
    allFields: any[],
    resolveFieldCode: (ref: any) => string | null,
): ConditionalAnyOfRule[] {
    const rules: ConditionalAnyOfRule[] = [];
    const seen = new Set<string>();

    const pushRule = (candidate: any) => {
        if (!candidate || typeof candidate !== 'object') return;
        const rawFields = Array.isArray(candidate.fields) ? candidate.fields : [];
        const fields = rawFields
            .map((f: any) => resolveFieldCode(f))
            .filter((f: string | null): f is string => Boolean(f));
        if (fields.length < 2) return;
        const normalized = {
            fields,
            when: candidate.when ?? null,
            message: typeof candidate.message === 'string' ? candidate.message : undefined,
        };
        const key = JSON.stringify(normalized);
        if (seen.has(key)) return;
        seen.add(key);
        rules.push(normalized);
    };

    allFields.forEach((field: any) => {
        const validation = safeParseJSON(field?.validation_rule) || {};
        const direct = validation?.required_any_of ?? validation?.conditional_any_of ?? validation?.at_least_one_of;
        if (Array.isArray(direct)) {
            direct.forEach((r: any) => pushRule(r));
        } else if (direct && typeof direct === 'object') {
            pushRule(direct);
        }
    });

    return rules;
}

function buildAddMoreRowRules(
    rules: any[],
    resolveFieldCode: (ref: any) => string | null,
): AddMoreRowRule[] {
    const out: AddMoreRowRule[] = [];
    const seen = new Set<string>();
    const rows = Array.isArray(rules) ? rules : [];

    rows.forEach((r: any) => {
        if (String(r?.is_active ?? '').toUpperCase() !== 'Y') return;
        const thenJson = safeParseJSON(r?.then_json) || {};
        const actions = Array.isArray(thenJson?.actions) ? thenJson.actions : [];

        actions.forEach((a: any) => {
            if (String(a?.action || '') !== 'addmore_row_count') return;
            const targetGroupId = Number(a?.targetGroupId);
            if (!Number.isFinite(targetGroupId) || targetGroupId <= 0) return;
            const sourceField = resolveFieldCode(a?.sourceField);
            if (!sourceField) return;
            const modeRaw = String(a?.mode || 'exact').toLowerCase();
            const mode: 'exact' | 'min' | 'max' =
                modeRaw === 'min' || modeRaw === 'max' ? (modeRaw as 'min' | 'max') : 'exact';
            const defaultApplyOn: Array<'add' | 'page_save' | 'submit'> = ['add', 'page_save', 'submit'];
            const applyOnRaw = Array.isArray(a?.applyOn) ? a.applyOn : defaultApplyOn;
            const applyOn = applyOnRaw
                .map((x: any) => String(x || '').toLowerCase())
                .filter((x: string) => x === 'add' || x === 'page_save' || x === 'submit') as Array<
                    'add' | 'page_save' | 'submit'
                >;
            const normalizedApplyOn: Array<'add' | 'page_save' | 'submit'> =
                applyOn.length > 0 ? applyOn : defaultApplyOn;
            const key = `${r?.id}|${targetGroupId}|${sourceField}|${mode}|${normalizedApplyOn.join(',')}`;
            if (seen.has(key)) return;
            seen.add(key);
            out.push({
                id: Number(r?.id || 0),
                targetGroupId,
                sourceField,
                mode,
                applyOn: normalizedApplyOn,
                message: typeof a?.message === 'string' ? a.message : undefined,
                when: safeParseJSON(r?.when_json),
            });
        });
    });

    return out.sort((a, b) => a.id - b.id);
}

// ✅ ISOLATED DYNAMIC DROPDOWN FOR ADD-MORE ROWS
function AddMoreDynamicDropdown({ masterId, parentValue, value, onChange, disabled, placeholder, className, appendTo, isMulti }: any) {
    const [opts, setOpts] = useState<any[]>([]);
    const shouldFetchRef = useRef(true);

    useEffect(() => {
        if (!masterId) return;

        shouldFetchRef.current = true;

        if (parentValue !== undefined && isEmptyValue(parentValue)) {
            setOpts([]);
            return;
        }

        const parentValueParam = Array.isArray(parentValue) ? parentValue.join(',') : String(parentValue ?? '');

        apiClient.get(`/investor/services/master-tables/${masterId}/options`, {
            params: { parentValue: parentValueParam, includeInactive: 1, take: 20000 }
        }).then(res => {
            if (shouldFetchRef.current) setOpts(res.data || []);
        }).catch(() => {
            if (shouldFetchRef.current) setOpts([]);
        });

        return () => {
            shouldFetchRef.current = false;
        };

    }, [masterId, parentValue]);

    const normalizedOpts = opts.map(o => ({ label: o.label, value: String(o.value) }));

    if (isMulti) return <MultiSelect className={className} value={value ?? []} options={normalizedOpts} onChange={(e) => onChange(e.value)} disabled={disabled} placeholder={placeholder} filter display="chip" appendTo={appendTo} />;
    return <Dropdown className={className} value={value ? String(value) : null} options={normalizedOpts} onChange={(e) => onChange(e.value)} placeholder={placeholder} disabled={disabled} filter appendTo={appendTo} showClear />;
}

// ✅ MAIN DROPDOWN COMPONENT (FOR GLOBAL FORM)
function MasterDropdown({ masterCode, parentValue, value, onChange, disabled, placeholder, className, appendTo, isMulti }: any) {
    const [opts, setOpts] = useState<any[]>([]);

    useEffect(() => {
        if (!masterCode) return;
        if (parentValue !== undefined && isEmptyValue(parentValue)) {
            // eslint-disable-next-line
            setOpts([]);
            return;
        }

        const parentValueParam = Array.isArray(parentValue) ? parentValue.join(',') : String(parentValue ?? '');

        apiClient.get(`/master/master-options`, {
            params: { code: masterCode, parent: parentValueParam }
        }).then(res => setOpts(res.data || [])).catch(() => setOpts([]));

    }, [masterCode, parentValue]);

    const normalizedOpts = opts.map(o => ({ label: o.label, value: String(o.value) }));

    // Match plugin-provided default label against option values
    useEffect(() => {
        if (
            !value ||
            !normalizedOpts.length ||
            (typeof value === 'string' && normalizedOpts.some((opt: any) => opt.value === value))
        ) {
            return; // Value is already set or matches an option value
        }

        // If value is a string (like "Maharashtra") but not in options, try to find matching label
        if (typeof value === 'string') {
            const matchingOption = normalizedOpts.find(
                (opt: any) => opt.label?.toLowerCase() === value.toLowerCase(),
            );
            if (matchingOption && matchingOption.value !== value) {
                onChange(matchingOption.value);
            }
        }
    }, [normalizedOpts, value, onChange]);

    if (isMulti) return <MultiSelect className={className} value={value ?? []} options={normalizedOpts} onChange={(e) => onChange(e.value)} disabled={disabled} placeholder={placeholder} filter display="chip" appendTo={appendTo} />;
    return <Dropdown className={className} value={value ? String(value) : null} options={normalizedOpts} onChange={(e) => onChange(e.value)} placeholder={placeholder} disabled={disabled} filter appendTo={appendTo} showClear />;
}

function DynamicFieldDropdown({ masterId, parentValue, value, onChange, disabled, placeholder, className, appendTo, isMulti }: any) {
    const [opts, setOpts] = useState<any[]>([]);

    useEffect(() => {
        if (!masterId) return;
        if (parentValue !== undefined && isEmptyValue(parentValue)) {
            // eslint-disable-next-line
            setOpts([]);
            return;
        }

        const parentValueParam = Array.isArray(parentValue) ? parentValue.join(',') : String(parentValue ?? '');

        apiClient.get(`/investor/services/master-tables/${masterId}/options`, {
            params: { parentValue: parentValueParam, includeInactive: 1, take: 20000 }
        }).then(res => setOpts(res.data || [])).catch(() => setOpts([]));
    }, [masterId, parentValue]);

    const normalizedOpts = opts.map(o => ({ label: o.label, value: String(o.value) }));

    // Match plugin-provided default label against option values
    useEffect(() => {
        if (
            !value ||
            !normalizedOpts.length ||
            (typeof value === 'string' && normalizedOpts.some((opt: any) => opt.value === value))
        ) {
            return; // Value is already set or matches an option value
        }

        // If value is a string (like "Maharashtra") but not in options, try to find matching label
        if (typeof value === 'string') {
            const matchingOption = normalizedOpts.find(
                (opt: any) => opt.label?.toLowerCase() === value.toLowerCase(),
            );
            if (matchingOption && matchingOption.value !== value) {
                onChange(matchingOption.value);
            }
        }
    }, [normalizedOpts, value, onChange]);

    if (isMulti) return <MultiSelect className={className} value={value ?? []} options={normalizedOpts} onChange={(e) => onChange(e.value)} disabled={disabled} placeholder={placeholder} filter display="chip" appendTo={appendTo} />;
    return <Dropdown className={className} value={value ? String(value) : null} options={normalizedOpts} onChange={(e) => onChange(e.value)} placeholder={placeholder} disabled={disabled} filter appendTo={appendTo} showClear />;
}

export function FormRenderer({
    config,
    serviceId,
    enablePreview,
    submissionId,
    onSubmit,
    onSaveNext,
    onCancel,
    isSubmitting = false,
    initialData,
    initialPageIndex = 0,
    readOnly = false,
    finalActionLabel,
    onActionButton,
    onEnsureSubmissionId,
}: Props) {
    const scrollToFirstInvalidField = useCallback(() => {
        if (typeof window === 'undefined') return;
        window.requestAnimationFrame(() => {
            const target = document.querySelector('.p-invalid, .is-invalid') as HTMLElement | null;
            if (!target) return;
            target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            if (typeof target.focus === 'function') {
                target.focus({ preventScroll: true });
            }
        });
    }, []);

    const [activePageIndex, setActivePageIndex] = useState(initialPageIndex);
    const didMountRef = useRef(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!didMountRef.current) {
            didMountRef.current = true;
            return;
        }

        window.requestAnimationFrame(() => {
            window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
        });
    }, [activePageIndex]);

    // Track which pages have been completed (saved & next'd). Pre-fill based on initialPageIndex.
    const [completedPages, setCompletedPages] = useState<Set<number>>(
        () => new Set(Array.from({ length: initialPageIndex }, (_, i) => i))
    );
    const [values, setValues] = useState<Record<string, any>>(initialData?.fields || {});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [touched, setTouched] = useState<Set<string>>(new Set());
    const [addMoreValues, setAddMoreValues] = useState<Record<number, any[]>>(initialData?.addMore || {});
    const [repeatablePageValues, setRepeatablePageValues] = useState<Record<number, any[]>>(initialData?.repeatablePages || {});
    const [repeatablePageGroupErrors, setRepeatablePageGroupErrors] = useState<Record<number, string>>({});
    const appendTo = useMemo(() => (typeof window === 'undefined' ? undefined : document.body), []);
    const [uploadedDocByChecklistId, setUploadedDocByChecklistId] = useState<Record<number, any>>({});
    const [uploadingDocId, setUploadingDocId] = useState<number | null>(null);
    const [uploadErrorByChecklistId, setUploadErrorByChecklistId] = useState<Record<number, string>>({});
    const [uploadingFileByKey, setUploadingFileByKey] = useState<Record<string, boolean>>({});
    const [fileUploadErrorByKey, setFileUploadErrorByKey] = useState<Record<string, string>>({});
    const [addMoreGroupErrors, setAddMoreGroupErrors] = useState<Record<number, string>>({});
    const [showPreview, setShowPreview] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [importType, setImportType] = useState<ImportType | null>(null);
    const [importingRepeatablePageConfigId, setImportingRepeatablePageConfigId] = useState<number | null>(null);
    const apiBaseUrl = String(process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
    const autoFetchedSignatureByFieldRef = React.useRef<Record<string, string>>({});
    const autoFetchResponseCacheRef = React.useRef<Record<string, any>>({});
    const autoFetchPendingBySignatureRef = React.useRef<Record<string, Promise<any>>>({});

    const pages = config?.pages ?? [];
    const rules = Array.isArray(config?.rules) ? config.rules : [];
    const plugin = useServicePlugin(serviceId);
    const authUser = useAuthStore((s) => s.user);
    const activePage = pages[activePageIndex];
    const isLastPage = activePageIndex === pages.length - 1;
    const valuesRef = useRef<Record<string, any>>(values);

    useEffect(() => {
        setValues(initialData?.fields || {});
        setAddMoreValues(initialData?.addMore || {});
        setRepeatablePageValues(initialData?.repeatablePages || {});
    }, [initialData]);

    useEffect(() => {
        setCompletedPages(new Set(Array.from({ length: initialPageIndex }, (_, i) => i)));
        setActivePageIndex(initialPageIndex);
    }, [initialPageIndex]);

    const allFields = useMemo(() => {
        const out: any[] = [];
        (pages || []).forEach((p: any) => p.categories?.forEach((c: any) => c.fields?.forEach((f: any) => out.push(f))));
        return out;
    }, [pages]);

    const hiddenRepeatableFieldCodes = useMemo(() => {
        const codes = new Set<string>();
        allFields.forEach((field: any) => {
            if (field.input_type === 'repeatable_page' && field.repeatable_page_config?.categories) {
                field.repeatable_page_config.categories.forEach((cat: any) => {
                    (cat.fields || []).forEach((subField: any) => {
                        if (subField.field_code) {
                            codes.add(String(subField.field_code));
                        }
                    });
                });
            }
        });
        return codes;
    }, [allFields]);

    const maxAccessiblePageIndex = useMemo(() => {
        const completed = Array.from(completedPages).sort((a, b) => a - b);
        const highestCompleted = completed.length ? completed[completed.length - 1] : -1;
        return Math.max(activePageIndex, Math.min(highestCompleted + 1, pages.length - 1));
    }, [completedPages, activePageIndex, pages.length]);

    const canNavigateToPage = useCallback((idx: number) => {
        return idx <= maxAccessiblePageIndex;
    }, [maxAccessiblePageIndex]);

    useEffect(() => {
        const defaults = buildDefaultValuesForFields(allFields);
        if (Object.keys(defaults).length === 0) return;

        setValues((prev) => {
            let changed = false;
            const next = { ...prev };
            for (const [fieldCode, defaultValue] of Object.entries(defaults)) {
                if (!isEmptyValue(next[fieldCode])) continue;
                next[fieldCode] = defaultValue;
                changed = true;
            }
            return changed ? next : prev;
        });
    }, [allFields, initialData]);

    useEffect(() => {
        setRepeatablePageValues((prev) => {
            const next = { ...prev };
            let changed = false;

            const repeatableFields = allFields.filter((field: any) => field.input_type === 'repeatable_page' && field.repeatable_page_config);
            repeatableFields.forEach((field: any) => {
                const config = field.repeatable_page_config;
                if (!config) return;

                // Skip if already initialized in this render
                if (next[config.id] !== undefined) return;

                // Get min_rows value
                const minRows = Math.max(0, Number(config.min_rows ?? 0));

                // First check if there's initial data for this repeatable page config (and it has rows)
                const initialRepeatableData = initialData?.repeatablePages?.[config.id];
                if (initialRepeatableData && Array.isArray(initialRepeatableData) && initialRepeatableData.length > 0) {
                    // Use existing data from draft
                    next[config.id] = initialRepeatableData;
                    changed = true;
                } else {
                    // Initialize with minRows empty template rows (or empty array if minRows = 0)
                    if (minRows > 0) {
                        const rowTemplate = buildDefaultValuesForFields(
                            (config.categories || []).flatMap((category: any) => category.fields || []),
                        );
                        next[config.id] = Array.from({ length: minRows }, () => ({ ...rowTemplate }));
                    } else {
                        next[config.id] = [];
                    }
                    changed = true;
                }
            });

            return changed ? next : prev;
        });
    }, [allFields, initialData]);

    // When service/initialData changes, immediately apply plugin defaults to override old values
    useEffect(() => {
        if (!plugin?.getFieldDefaultValue || !allFields.length) return;

        // When initialData changes (service changed), reapply defaults even if fields have values
        const serviceDefaults: Record<string, any> = {};
        let hasServiceDefaults = false;

        allFields.forEach((field: any) => {
            const defaultValue = plugin?.getFieldDefaultValue?.(field.field_code, {});
            if (defaultValue !== undefined) {
                serviceDefaults[field.field_code] = defaultValue;
                hasServiceDefaults = true;
            }
        });

        if (hasServiceDefaults) {
            setValues((prev) => {
                const next = { ...prev };
                // Only apply defaults to empty fields to preserve user input
                Object.entries(serviceDefaults).forEach(([code, defVal]) => {
                    if (isEmptyValue(next[code])) {
                        next[code] = defVal;
                    }
                });
                return next;
            });
        }
    }, [plugin, allFields, initialData]);

    // Apply plugin default values for empty fields during normal rendering
    useEffect(() => {
        if (!plugin?.getFieldDefaultValue || !allFields.length) return;

        const pluginDefaults: Record<string, any> = {};
        let hasDefaults = false;

        allFields.forEach((field: any) => {
            if (isEmptyValue(values[field.field_code])) {
                const defaultValue = plugin?.getFieldDefaultValue?.(field.field_code, values);
                if (defaultValue !== undefined) {
                    pluginDefaults[field.field_code] = defaultValue;
                    hasDefaults = true;
                }
            }
        });

        if (hasDefaults) {
            setValues((prev) => ({ ...prev, ...pluginDefaults }));
        }
    }, [plugin, allFields]);

    useEffect(() => {
        valuesRef.current = values;
    }, [values]);

    useEffect(() => {
        if (!plugin?.onFieldChange) return;
        let cancelled = false;

        Promise.resolve(plugin.onFieldChange('__INIT__', undefined, valuesRef.current || {}))
            .then((pluginResult) => {
                if (cancelled) return;
                if (!pluginResult || typeof pluginResult !== 'object') return;
                setValues((prev) => {
                    let changed = false;
                    const next = { ...prev };
                    Object.entries(pluginResult).forEach(([k, v]) => {
                        if (next[k] !== v) {
                            next[k] = v;
                            changed = true;
                        }
                    });
                    return changed ? next : prev;
                });
            })
            .catch(() => {
                // Ignore plugin init failures to keep form runtime stable.
            });

        return () => {
            cancelled = true;
        };
    }, [plugin, initialData, authUser?.firstName, authUser?.lastName, authUser?.email]);

    // ── Formula Engine: scan all fields for component_props.formula ──────────
    const formulaFields = useMemo(() => {
        const map: Record<string, {
            expression: string;
            decimals: number;
            prefix: string;
            suffix: string;
            onError: string;
        }> = {};
        allFields.forEach((f: any) => {
            let cp = f?.component_props;
            if (typeof cp === 'string') { try { cp = JSON.parse(cp); } catch { cp = {}; } }
            const formula = cp?.formula;
            if (formula?.enabled && String(formula?.expression ?? '').trim()) {
                map[f.field_code] = {
                    expression: String(formula.expression).trim(),
                    decimals: formula.resultFormat?.decimals ?? 0,
                    prefix: formula.resultFormat?.prefix ?? '',
                    suffix: formula.resultFormat?.suffix ?? '',
                    onError: formula.onError ?? 'showZero',
                };
            }
        });
        return map;
    }, [allFields]);

    // Stores formatted display values (with prefix/suffix) separately from raw values
    // so that raw numeric values in `values` remain usable for chained formula calculations.
    const [formulaDisplayValues, setFormulaDisplayValues] = useState<Record<string, string>>({});

    // Pre-load mathjs on mount; track readiness so formula effect re-runs after load
    const [mathjsReady, setMathjsReady] = useState(false);
    useEffect(() => { preloadMathjs().then(() => setMathjsReady(true)); }, []);

    // ── Formula Engine: auto-calculate whenever form values change ───────────
    useEffect(() => {
        if (!mathjsReady) return;                    // wait until mathjs is loaded
        const codes = Object.keys(formulaFields);
        if (codes.length === 0) return;

        const rawUpdates: Record<string, string> = {};
        const displayUpdates: Record<string, string> = {};
        let hasRawChanges = false;
        let hasDisplayChanges = false;

        codes.forEach((fieldCode) => {
            const { expression, decimals, prefix, suffix, onError } = formulaFields[fieldCode];
            const result = evaluateFormulaSync(expression, values, { decimals, prefix, suffix });

            let rawVal: string;
            let displayVal: string;

            if (result.error !== null) {
                rawVal = onError === 'showZero' ? Number(0).toFixed(decimals) : onError === 'showError' ? '#ERROR' : '';
                displayVal = onError === 'showZero' ? `${prefix}${Number(0).toFixed(decimals)}${suffix}` : onError === 'showError' ? '#ERROR' : '';
            } else if (result.value !== null) {
                rawVal = Number(result.value).toFixed(decimals);
                displayVal = result.formatted;          // includes prefix + suffix
            } else {
                rawVal = '';
                displayVal = '';
            }

            if (String(values[fieldCode] ?? '') !== rawVal) {
                rawUpdates[fieldCode] = rawVal;
                hasRawChanges = true;
            }
            if ((formulaDisplayValues[fieldCode] ?? '') !== displayVal) {
                displayUpdates[fieldCode] = displayVal;
                hasDisplayChanges = true;
            }
        });

        if (hasRawChanges) setValues((prev) => ({ ...prev, ...rawUpdates }));
        if (hasDisplayChanges) setFormulaDisplayValues((prev) => ({ ...prev, ...displayUpdates }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [values, formulaFields, mathjsReady]);

    const fieldIdToCode = useMemo(() => {
        const map = new Map<number, string>();
        allFields.forEach((f: any) => {
            if (f?.id && f?.field_code) map.set(Number(f.id), String(f.field_code));
        });
        return map;
    }, [allFields]);

    const resolveFieldCode = useCallback((ref: any): string | null => {
        if (ref === null || ref === undefined) return null;
        if (typeof ref === 'number') return fieldIdToCode.get(ref) ?? null;
        const s = String(ref).trim();
        if (!s) return null;
        if (/^\d+$/.test(s)) return fieldIdToCode.get(Number(s)) ?? null;
        return s;
    }, [fieldIdToCode]);

    const computedOverrides = useMemo<Record<string, FieldOverrides>>(() => {
        const out: Record<string, FieldOverrides> = {};
        const activeRulesRaw = rules.filter((r: any) => String(r?.is_active ?? '').toUpperCase() === 'Y');
        const latestRuleByWhen = new Map<string, any>();
        activeRulesRaw.forEach((r: any) => {
            const key = JSON.stringify(safeParseJSON(r?.when_json) ?? {});
            const prev = latestRuleByWhen.get(key);
            if (!prev || Number(r?.id || 0) > Number(prev?.id || 0)) {
                latestRuleByWhen.set(key, r);
            }
        });
        const activeRules = Array.from(latestRuleByWhen.values()).sort(
            (a: any, b: any) => Number(a?.id || 0) - Number(b?.id || 0),
        );

        for (const r of activeRules) {
            try {
                if (evalConditionTree(r?.when_json, values, resolveFieldCode)) {
                    const actions = normalizeThenActions(r?.then_json, resolveFieldCode);
                    for (const a of actions) {
                        if (!out[a.field]) out[a.field] = {};
                        out[a.field][a.prop] = a.value;
                    }
                }
            } catch {
                // Ignore malformed rule payloads to avoid breaking form runtime.
            }
        }

        // ✅ Apply plugin-level visibility overrides
        if (plugin?.isFieldVisible) {
            for (const field of allFields) {
                const fieldCode = field.field_code;
                const pluginVis = plugin.isFieldVisible(fieldCode, values);
                if (pluginVis !== undefined) {
                    if (!out[fieldCode]) out[fieldCode] = {};
                    out[fieldCode].visible = pluginVis;
                }
            }
        }

        if (plugin?.isFieldRequired) {
            for (const field of allFields) {
                const fieldCode = field.field_code;
                const pluginRequired = plugin.isFieldRequired(fieldCode, values);
                if (pluginRequired !== undefined) {
                    if (!out[fieldCode]) out[fieldCode] = {};
                    out[fieldCode].required = pluginRequired;
                }
            }
        }

        return out;
    }, [rules, values, resolveFieldCode, plugin, allFields]);

    const conditionalAnyOfRules = useMemo(
        () => buildConditionalAnyOfRules(allFields, resolveFieldCode),
        [allFields, resolveFieldCode],
    );

    const addMoreRowRules = useMemo(
        () => buildAddMoreRowRules(rules, resolveFieldCode),
        [rules, resolveFieldCode],
    );

    const hiddenAddMoreChildFieldIds = useMemo(() => {
        const ids = new Set<number>();
        const codes = new Set<string>();
        (pages || []).forEach((p: any) =>
            p.categories?.forEach((c: any) =>
                c.fields?.forEach((f: any) => {
                    if (String(f?.input_type).toLowerCase() !== 'addmore') return;
                    (f.add_more_groups || []).forEach((g: any) =>
                        (g.columns || []).forEach((col: any) => {
                            if (col?.builder_field_id) ids.add(Number(col.builder_field_id));
                            if (col?.field_code) codes.add(String(col.field_code));
                        })
                    );
                })
            )
        );
        return { ids, codes };
    }, [pages]);

    useEffect(() => {
        if (readOnly) return;
        if (!Array.isArray(allFields) || allFields.length === 0) return;

        const replaceTokens = (raw: string) => {
            return String(raw || '').replace(/\{\{\s*([^}]+)\s*\}\}/g, (_m, tokenRaw) => {
                const token = String(tokenRaw || '').trim();
                if (!token) return '';
                if (token === 'serviceId') return String(serviceId || '');
                if (token === 'submissionId') return String(submissionId || '');
                return String(values?.[token] ?? '');
            });
        };

        allFields.forEach((sourceField: any) => {
            const sourceInputType = String(sourceField?.input_type || '').toLowerCase().trim();
            if (
                sourceInputType !== 'text' &&
                sourceInputType !== 'email' &&
                sourceInputType !== 'tel' &&
                sourceInputType !== 'number'
            ) return;

            const cfg = resolveTextApiConfig(sourceField);
            if (!cfg?.apiUrl) return;

            const triggerField = String(cfg.triggerField || '').trim();
            if (triggerField && isEmptyValue(values?.[triggerField])) return;

            const resolvedUrl = replaceTokens(cfg.apiUrl);
            if (!resolvedUrl) return;

            const params: Record<string, any> = {};
            const paramsMap =
                cfg.paramsFromFields && typeof cfg.paramsFromFields === 'object'
                    ? cfg.paramsFromFields
                    : {};
            Object.entries(paramsMap).forEach(([paramKey, fieldCodeRef]: any) => {
                const sourceCode = String(fieldCodeRef || '').trim();
                if (!sourceCode) return;
                params[paramKey] = values?.[sourceCode] ?? '';
            });

            const mappingsRaw = Array.isArray(cfg.mappings) ? cfg.mappings : [];
            const mappings = mappingsRaw
                .map((m: any) => ({
                    targetField: String(
                        m?.targetField ??
                        m?.target_field ??
                        m?.targetFieldCode ??
                        m?.target_field_code ??
                        m?.field ??
                        '',
                    ).trim(),
                    responsePath: String(m?.responsePath ?? m?.response_path ?? cfg.responsePath ?? '').trim(),
                    valueKey: String(m?.valueKey ?? m?.value_key ?? '').trim(),
                }))
                .filter((m: any) => m.targetField && m.valueKey);

            if (mappings.length === 0 && String(cfg.valueKey || '').trim()) {
                mappings.push({
                    targetField: String(sourceField?.field_code || '').trim(),
                    responsePath: String(cfg.responsePath || '').trim(),
                    valueKey: String(cfg.valueKey || '').trim(),
                });
            }
            if (mappings.length === 0) return;

            const hasAtLeastOneFillableTarget = mappings.some((m: any) => {
                const current = values?.[m.targetField];
                return cfg.overwrite || isEmptyValue(current);
            });
            if (!hasAtLeastOneFillableTarget) return;

            const signature = JSON.stringify({
                url: resolvedUrl,
                method: cfg.method || 'GET',
                params,
                triggerValue: triggerField ? values?.[triggerField] : '',
            });
            const sourceCodeKey = String(sourceField?.field_code || sourceField?.id || '');
            if (autoFetchedSignatureByFieldRef.current[sourceCodeKey] === signature) return;
            autoFetchedSignatureByFieldRef.current[sourceCodeKey] = signature;

            const isAbsolute = /^https?:\/\//i.test(resolvedUrl);
            const requestUrl = isAbsolute ? resolvedUrl : resolvedUrl.startsWith('/') ? resolvedUrl : `/${resolvedUrl}`;
            const method = String(cfg.method || 'GET').toUpperCase();

            const getPayloadForSignature = (): Promise<any> => {
                if (autoFetchResponseCacheRef.current[signature] !== undefined) {
                    return Promise.resolve(autoFetchResponseCacheRef.current[signature]);
                }
                const pending = autoFetchPendingBySignatureRef.current[signature];
                if (pending) return pending;

                const req =
                    method === 'POST'
                        ? apiClient.post(requestUrl, params)
                        : apiClient.get(requestUrl, { params });
                const reqPromise = req
                    .then((res: any) => {
                        const payload = res?.data;
                        autoFetchResponseCacheRef.current[signature] = payload;
                        return payload;
                    })
                    .finally(() => {
                        delete autoFetchPendingBySignatureRef.current[signature];
                    });
                autoFetchPendingBySignatureRef.current[signature] = reqPromise;
                return reqPromise;
            };

            getPayloadForSignature()
                .then((payload: any) => {
                    setValues((prev) => {
                        let changed = false;
                        const next = { ...prev };

                        mappings.forEach((m: any) => {
                            const byPath = m.responsePath ? getByPath(payload, m.responsePath) : payload;
                            const picked = getByPath(byPath, m.valueKey);
                            if (picked === undefined || picked === null) return;

                            const normalized = typeof picked === 'string' ? picked : String(picked);
                            const prevVal = prev?.[m.targetField];
                            if (!cfg.overwrite && !isEmptyValue(prevVal)) return;
                            if (String(prevVal ?? '') === String(normalized ?? '')) return;
                            next[m.targetField] = normalized;
                            changed = true;
                        });

                        return changed ? next : prev;
                    });
                })
                .catch(() => {
                    // ignore auto-fetch failure; manual user input remains available
                });
        });
    }, [allFields, readOnly, serviceId, submissionId, values]);

    const dmsChecklists = useMemo(() => {
        const types = Array.isArray(config?.dms?.documentTypes) ? config.dms.documentTypes : [];
        return types.flatMap((type: any) => {
            const checklists = Array.isArray(type?.checklists) ? type.checklists : [];
            return checklists.map((checklist: any) => ({
                ...checklist,
                __typeName: type?.name || '',
            }));
        });
    }, [config]);

    const evaluateCondition = useCallback((condition: any) => {
        if (!condition?.fieldName) return true;
        const left = values?.[condition.fieldName];
        const rightRaw = condition?.value;
        const operator = String(condition?.operator || 'eq').toLowerCase();

        const leftStr = left === undefined || left === null ? '' : String(left);
        const rightStr = rightRaw === undefined || rightRaw === null ? '' : String(rightRaw);
        const leftNum = Number(left);
        const rightNum = Number(rightRaw);

        switch (operator) {
            case 'eq': return leftStr === rightStr;
            case 'neq': return leftStr !== rightStr;
            case 'gt': return Number.isFinite(leftNum) && Number.isFinite(rightNum) ? leftNum > rightNum : false;
            case 'gte': return Number.isFinite(leftNum) && Number.isFinite(rightNum) ? leftNum >= rightNum : false;
            case 'lt': return Number.isFinite(leftNum) && Number.isFinite(rightNum) ? leftNum < rightNum : false;
            case 'lte': return Number.isFinite(leftNum) && Number.isFinite(rightNum) ? leftNum <= rightNum : false;
            case 'contains': return leftStr.toLowerCase().includes(rightStr.toLowerCase());
            default: return true;
        }
    }, [values]);

    const docsForField = useCallback((fieldCode: string) => {
        return dmsChecklists.filter((doc: any) => {
            const showAfterField = String(doc?.showAfter?.fieldName || '').trim();
            if (!showAfterField || showAfterField !== fieldCode) return false;
            return evaluateCondition(doc?.showCondition);
        });
    }, [dmsChecklists, evaluateCondition]);

    const getEffectiveAddMoreConstraint = useCallback((
        groupId: number,
        stage: 'add' | 'page_save' | 'submit',
    ): { mode: 'exact' | 'min' | 'max'; expectedRows: number; message?: string } | null => {
        const candidates = addMoreRowRules
            .filter((r) => Number(r.targetGroupId) === Number(groupId) && r.applyOn.includes(stage))
            .filter((r) => {
                if (!r.when || (typeof r.when === 'object' && Array.isArray((r.when as any).all) && (r.when as any).all.length === 0)) return true;
                try {
                    return evalConditionTree(r.when, values, resolveFieldCode);
                } catch {
                    return false;
                }
            })
            .sort((a, b) => b.id - a.id);
        const selected = candidates[0];
        if (!selected) return null;
        const sourceRaw = values?.[selected.sourceField];
        const expectedRows = Number(sourceRaw);
        if (!Number.isFinite(expectedRows) || expectedRows <= 0) return null;
        return {
            mode: selected.mode,
            expectedRows: Math.floor(expectedRows),
            message: selected.message,
        };
    }, [addMoreRowRules, resolveFieldCode, values]);

    const resolveFileUrl = useCallback((path?: string) => {
        const raw = String(path || '').trim();
        if (!raw) return '#';
        if (/^https?:\/\//i.test(raw)) return raw;
        const cleanPath = raw.replace(/^\/+/, '');
        if (!apiBaseUrl) return `/${cleanPath}`;
        return `${apiBaseUrl}/${cleanPath}`;
    }, [apiBaseUrl]);

    useEffect(() => {
        if (!submissionId || !serviceId) return;
        apiClient.get('/common/documents/uploads', { params: { submissionId, serviceId } })
            .then((res) => {
                const uploads = Array.isArray(res?.data?.uploads) ? res.data.uploads : [];
                const byChecklist: Record<number, any> = {};
                uploads.forEach((item: any) => {
                    const key = Number(item.documentMasterId);
                    if (Number.isFinite(key)) byChecklist[key] = item;
                });
                setUploadedDocByChecklistId(byChecklist);
            })
            .catch(() => setUploadedDocByChecklistId({}));
    }, [submissionId, serviceId]);

    const handleInlineDocumentUpload = useCallback(async (checklistId: number, file?: File | null) => {
        if (!file || !serviceId) return;
        const targetDoc = dmsChecklists.find((d: any) => Number(d?.id) === Number(checklistId));
        const allowedExts = normalizeAllowedFormats(targetDoc?.allowedFormats);
        const fileExt = getFileExt(file.name);
        if (allowedExts.length > 0 && (!fileExt || !allowedExts.includes(fileExt))) {
            setUploadErrorByChecklistId((prev) => ({
                ...prev,
                [checklistId]: `Invalid document type. Allowed: ${allowedExts.join(', ')}`,
            }));
            return;
        }

        try {
            setUploadingDocId(checklistId);
            setUploadErrorByChecklistId((prev) => ({ ...prev, [checklistId]: '' }));
            let resolvedSubmissionId = submissionId;
            if (!resolvedSubmissionId && onEnsureSubmissionId) {
                const ensuredId = await onEnsureSubmissionId({
                    values,
                    addMoreValues,
                    repeatablePageValues,
                    currentPageIndex: activePageIndex,
                });
                resolvedSubmissionId = Number(ensuredId || 0) || undefined;
            }

            if (!resolvedSubmissionId) {
                throw new Error('Please save the application once before uploading documents.');
            }

            const form = new FormData();
            form.append('file', file);
            form.append('submissionId', String(resolvedSubmissionId));
            form.append('documentMasterId', String(checklistId));
            form.append('serviceId', String(serviceId));
            form.append('uploadType', 'new');
            form.append('comments', '');
            form.append('validFrom', '');
            form.append('validTo', '');
            form.append('docDateOfIssuance', '');
            form.append('isDocumentActive', 'Y');

            const res = await apiClient.post('/common/documents/upload', form);
            const uploaded = res?.data?.data;
            if (uploaded) {
                setUploadedDocByChecklistId((prev) => ({
                    ...prev,
                    [checklistId]: {
                        ...prev[checklistId],
                        ...uploaded,
                        documentMasterId: checklistId,
                    },
                }));
            }
        } catch (e: any) {
            const message = e?.response?.data?.message || e?.message || 'Upload failed. Please try again.';
            setUploadErrorByChecklistId((prev) => ({ ...prev, [checklistId]: String(message) }));
        } finally {
            setUploadingDocId(null);
        }
    }, [submissionId, serviceId, dmsChecklists, onEnsureSubmissionId, values, addMoreValues, activePageIndex]);

    useEffect(() => {
        if (!config || (initialData?.addMore && Object.keys(initialData.addMore).length > 0)) return;
        const initialAddMore: any = {};
        pages.forEach((p: any) => {
            p.categories.forEach((c: any) => {
                c.fields.forEach((f: any) => {
                    if (f.input_type === 'addmore' && f.add_more_groups) {
                        f.add_more_groups.forEach((g: any) => {
                            const min = typeof g.min_rows === 'number' && g.min_rows > 0 ? g.min_rows : 1;
                            initialAddMore[g.id] = Array.from({ length: min }).map(() =>
                                buildDefaultValuesForFields(g.columns || []),
                            );
                        });
                    }
                });
            });
        });
        setAddMoreValues(initialAddMore);
    }, [config, initialData, pages]);

    const validateField = useCallback((field: any, value: any, override?: FieldOverrides) => {
        const required = override?.required ?? field.is_required === 'Y';
        if (required && isEmptyValue(value)) return 'This field is mandatory';

        const rules = (typeof field.validation_rule === 'string' ? safeParseJSON(field.validation_rule) : field.validation_rule) || {};
        //  ADD: min / max support (from DB columns OR validation_rule JSON)
        const min =
            typeof field.min_length === 'number'
                ? field.min_length
                : (typeof rules.min_length === 'number' ? rules.min_length : undefined);

        const max =
            typeof field.max_length === 'number'
                ? field.max_length
                : (typeof rules.max_length === 'number' ? rules.max_length : undefined);

        const inputType = String(field.input_type || '').toLowerCase();

        if (['date', 'datetime-local'].includes(inputType) && !allowsPreviousDate(rules) && isPreviousDateValue(value, inputType)) {
            return inputType === 'date'
                ? `${field.label || 'This field'} cannot be a previous date`
                : `${field.label || 'This field'} cannot be a previous date/time`;
        }

        if (['date', 'datetime-local'].includes(inputType) && !allowsFutureDate(rules) && isFutureDateValue(value, inputType)) {
            return inputType === 'date'
                ? `${field.label || 'This field'} cannot be a future date`
                : `${field.label || 'This field'} cannot be a future date/time`;
        }

        if (
            ['text', 'textarea', 'tel', 'number'].includes(inputType) &&
            isAadhaarVerhoeffEnabled(rules) &&
            !isEmptyValue(value) &&
            !isValidAadhaarNumber(value)
        ) {
            return rules.message || `${field.label || 'This field'} must be a valid Aadhaar number`;
        }

        // Number field: digit-count based min/max + regex + formula-based min/max
        if (inputType === 'number' && value !== null && value !== undefined && value !== '') {
            // Value may be stored as string (when max_length InputText mode) or as number
            const strVal = String(value).replace(/\D/g, ''); // keep only digits
            if (strVal === '' && String(value).trim() !== '') {
                return `${field.label || 'This field'} must be a valid number`;
            }
            const digitCount = strVal.length;
            if (typeof min === 'number' && digitCount < min) {
                return `${field.label || 'This field'} must be at least ${min} digit${min > 1 ? 's' : ''}`;
            }
            if (typeof max === 'number' && digitCount > max) {
                return `${field.label || 'This field'} must be at most ${max} digit${max > 1 ? 's' : ''}`;
            }

            // Formula-based min value validation
            const minValueFormula = rules.min_value_formula || rules.minValueFormula;
            if (minValueFormula && typeof minValueFormula === 'string') {
                try {
                    // Build formula context with formData and additionalDetailsGroup variables
                    const formulaContext: any = {
                        formData: { ...values },
                    };
                    // Add additionalDetailsGroup{id} from addMoreValues
                    if (addMoreValues && typeof addMoreValues === 'object') {
                        Object.entries(addMoreValues).forEach(([groupId, groupValue]) => {
                            formulaContext[`additionalDetailsGroup${groupId}`] = groupValue;
                        });
                    }

                    // console.log(`[validateField MIN] Field: ${field.field_code}, Formula: ${minValueFormula}, Context:`, formulaContext);
                    const formulaResult = evaluateFormulaSync(minValueFormula, formulaContext);
                    // console.log(`[validateField MIN] Result:`, formulaResult);

                    if (formulaResult.error === null && typeof formulaResult.value === 'number') {
                        const numericValue = Number(value);
                        // console.log(`[validateField MIN] Checking: ${numericValue} < ${formulaResult.value}`);
                        if (numericValue < formulaResult.value) {
                            return `${field.label || 'This field'} must be at least ${formulaResult.value}`;
                        }
                    }
                } catch (e) {
                    console.warn(`Formula evaluation failed for min_value_formula on field ${field.field_code}:`, e);
                }
            }

            // Formula-based max value validation
            const maxValueFormula = rules.max_value_formula || rules.maxValueFormula;
            if (maxValueFormula && typeof maxValueFormula === 'string') {
                try {
                    // Build formula context with formData and additionalDetailsGroup variables
                    const formulaContext: any = {
                        formData: { ...values },
                    };
                    // Add additionalDetailsGroup{id} from addMoreValues
                    if (addMoreValues && typeof addMoreValues === 'object') {
                        Object.entries(addMoreValues).forEach(([groupId, groupValue]) => {
                            formulaContext[`additionalDetailsGroup${groupId}`] = groupValue;
                        });
                    }

                    const formulaResult = evaluateFormulaSync(maxValueFormula, formulaContext);
                    if (formulaResult.error === null && typeof formulaResult.value === 'number') {
                        const numericValue = Number(value);
                        if (numericValue > formulaResult.value) {
                            return `${field.label || 'This field'} must be at most ${formulaResult.value}`;
                        }
                    }
                } catch (e) {
                    console.warn(`Formula evaluation failed for max_value_formula on field ${field.field_code}:`, e);
                }
            }

            const numPattern = rules.regex || rules.pattern || field.pattern;
            if (numPattern) {
                try {
                    if (!new RegExp(numPattern).test(String(value))) {
                        return `${field.label || 'This field'} format is invalid`;
                    }
                } catch { /* invalid regex — skip */ }
            }
        }

        // Text / textarea / email / tel: character-count based min/max + regex
        if (['text', 'textarea', 'email', 'tel'].includes(inputType) && typeof value === 'string' && value !== '') {
            const length = value.length;
            if (typeof min === 'number' && length < min) {
                return `${field.label || 'This field'} must be at least ${min} character${min > 1 ? 's' : ''}`;
            }
            if (typeof max === 'number' && length > max) {
                return `${field.label || 'This field'} must be at most ${max} character${max > 1 ? 's' : ''}`;
            }
            // Email: automatic format validation (unless user already set a custom regex)
            const pattern = rules.regex || rules.pattern || field.pattern;
            if (inputType === 'email' && !pattern && value.trim() !== '') {
                const emailRx = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
                if (!emailRx.test(value)) {
                    return `${field.label || 'This field'} must be a valid email address`;
                }
            }
            if (pattern && value.trim() !== '') {
                try {
                    if (!new RegExp(pattern).test(value)) {
                        return `${field.label || 'This field'} format is invalid`;
                    }
                } catch {
                    console.error('Invalid regex pattern:', pattern);
                }
            }
        }

        if (value instanceof File || (value && typeof value === 'object' && (value.name || value.filePath || value.file_path))) {
            const maxSizeMbRaw = rules.max_size_mb ?? rules.maxSizeMb ?? rules.max_size ?? rules.maxSize;
            const maxSizeMb = Number(maxSizeMbRaw);
            if (Number.isFinite(maxSizeMb) && maxSizeMb > 0) {
                const fileSize = Number((value as any)?.size || 0);
                if (fileSize > maxSizeMb * 1024 * 1024) {
                    return `File size must be up to ${maxSizeMb} MB`;
                }
            }

            const accept = rules.accept;
            if (accept) {
                const fileName = value.name || value.fileName || value.file_name || getStoredFileName(value);
                const fileExt = '.' + fileName.split('.').pop()?.toLowerCase();
                const acceptedTypes = accept.split(',').map((t: string) => t.trim().toLowerCase());
                if (!acceptedTypes.includes(fileExt) && !acceptedTypes.includes((value as any)?.type || '')) {
                    return `Invalid file type. Allowed: ${accept}`;
                }
            }
            return '';
        }

        if (plugin?.validateField) {
            const pluginError = plugin.validateField(String(field.field_code || ''), value, values);
            if (pluginError) return pluginError;
        }

        return '';
    }, [plugin, values, addMoreValues]);

    const validatePageAtIndex = useCallback((pageIndex: number) => {
        const targetPage = pages[pageIndex];
        const currentFields = targetPage?.categories.flatMap((c: any) => c.fields) || [];
        let valid = true;
        const newErrors: Record<string, string> = {};
        const newTouched = new Set<string>(['ALL_PAGE']);
        const nextAddMoreGroupErrors: Record<number, string> = {};

        const nextRepeatablePageGroupErrors: Record<number, string> = {};

        currentFields.forEach((field: any) => {
            const isHiddenAddMoreChild =
                (field?.id && hiddenAddMoreChildFieldIds.ids.has(Number(field.id))) ||
                (field?.field_code && hiddenAddMoreChildFieldIds.codes.has(String(field.field_code)));
            if (isHiddenAddMoreChild) return;

            if (field.field_code && hiddenRepeatableFieldCodes.has(field.field_code)) return;

            if (field.input_type !== 'addmore' && field.input_type !== 'button' && field.input_type !== 'repeatable_page') {
                const val = values[field.field_code];
                const ov = computedOverrides[field.field_code];
                if (ov?.visible === false) return;

                const required = ov?.required ?? field.is_required === 'Y';
                if (required && isEmptyValue(val)) {
                    newErrors[field.field_code] = 'This field is mandatory';
                    valid = false;
                    newTouched.add(field.field_code);
                }

                const err = validateField(field, val, ov);
                if (err) {
                    newErrors[field.field_code] = err;
                    valid = false;
                    newTouched.add(field.field_code);
                }
            } else {
                field.add_more_groups?.forEach((g: any) => {
                    const rows = addMoreValues[g.id] || [];
                    const groupIssues: string[] = [];
                    const minRows = g.min_rows || 0;
                    const maxRows = g.max_rows || null;

                    if (minRows > 0 && rows.length < minRows) {
                        valid = false;
                        nextAddMoreGroupErrors[g.id] = `At least ${minRows} row(s) required.`;
                    }
                    if (maxRows && rows.length > maxRows) {
                        valid = false;
                        nextAddMoreGroupErrors[g.id] = `Maximum ${maxRows} row(s) allowed.`;
                    }

                    const stage: 'page_save' | 'submit' = pageIndex === pages.length - 1 ? 'submit' : 'page_save';
                    const dynamic = getEffectiveAddMoreConstraint(g.id, stage);
                    if (dynamic) {
                        const expected = Number(dynamic.expectedRows);
                        if (Number.isFinite(expected)) {
                            if (dynamic.mode === 'exact' && rows.length !== expected) {
                                valid = false;
                                nextAddMoreGroupErrors[g.id] = dynamic.message || `Rows must be exactly ${expected}. Current: ${rows.length}.`;
                            }
                            if (dynamic.mode === 'min' && rows.length < expected) {
                                valid = false;
                                nextAddMoreGroupErrors[g.id] = dynamic.message || `At least ${expected} row(s) required.`;
                            }
                            if (dynamic.mode === 'max' && rows.length > expected) {
                                valid = false;
                                nextAddMoreGroupErrors[g.id] = dynamic.message || `Maximum ${expected} row(s) allowed.`;
                            }
                        }
                    }

                    rows.forEach((row: any, rIdx: number) => {
                        g.columns.forEach((col: any) => {
                            const val = row[col.field_code];
                            const fieldKey = `${g.id}_${rIdx}_${col.field_code}`;
                            if (col.is_required === 'Y' && isEmptyValue(val)) {
                                valid = false;
                                newErrors[fieldKey] = 'This field is mandatory';
                                newTouched.add(fieldKey);
                                groupIssues.push(`Row ${rIdx + 1}: ${col.label || 'This field'}`);
                                return;
                            }

                            const err = validateField(col, val);
                            if (err) {
                                valid = false;
                                newErrors[fieldKey] = err;
                                newTouched.add(fieldKey);
                                groupIssues.push(`Row ${rIdx + 1}: ${col.label || 'This field'}`);
                            }
                        });
                    });

                    if (!nextAddMoreGroupErrors[g.id] && groupIssues.length > 0) {
                        const uniqueIssues = Array.from(new Set(groupIssues));
                        nextAddMoreGroupErrors[g.id] = `Please complete required Add More fields: ${uniqueIssues.join(', ')}`;
                    }
                });

                // Validate repeatable page fields
                if (field.input_type === 'repeatable_page' && field.repeatable_page_config) {
                    const config = field.repeatable_page_config;
                    const rows = repeatablePageValues[config.id] || [];

                    // Resolve min_rows: formula first, then explicit value, default to 0 (not required unless specified)
                    let minRows = 0;
                    if (config.min_rows_formula) {
                        const formulaResult = evaluateFormulaSync(config.min_rows_formula, values);
                        minRows = Number(formulaResult?.value ?? 0) || 0;
                    } else if (config.min_rows !== null && config.min_rows !== undefined) {
                        minRows = Number(config.min_rows) || 0;
                    }

                    const maxRows = evaluateFormulaSync(config.max_rows_formula || '', values)?.value ?? config.max_rows;

                    // Check if we have enough rows
                    if (minRows > 0 && rows.length < minRows) {
                        valid = false;
                        nextRepeatablePageGroupErrors[config.id] = `At least ${minRows} section(s) required.`;
                    }
                    if (maxRows && rows.length > maxRows) {
                        valid = false;
                        nextRepeatablePageGroupErrors[config.id] = `Maximum ${maxRows} section(s) allowed.`;
                    }

                    rows.forEach((row: any, rIdx: number) => {
                        (config.categories || []).forEach((cat: any) => {
                            (cat.fields || []).forEach((catField: any) => {
                                const fieldCode = String(catField.field_code || catField.id || '');
                                if (!fieldCode) return;

                                const val = row[fieldCode];
                                const fieldKey = `rep_${config.id}_${rIdx}_${fieldCode}`;

                                // Validate required fields in ALL rows (consistent with AddMore validation)
                                if (catField.is_required === 'Y' && isEmptyValue(val)) {
                                    valid = false;
                                    newErrors[fieldKey] = 'This field is mandatory';
                                    newTouched.add(fieldKey);
                                }

                                // Validate field format only if value is not empty
                                if (!isEmptyValue(val)) {
                                    const err = validateField(catField, val);
                                    if (err) {
                                        valid = false;
                                        newErrors[fieldKey] = err;
                                        newTouched.add(fieldKey);
                                    }
                                }
                            });
                        });
                    });
                }
            }
        });

        setRepeatablePageGroupErrors(nextRepeatablePageGroupErrors);

        conditionalAnyOfRules.forEach((rule) => {
            const isWhenMatched = rule.when ? evalConditionTree(rule.when, values, resolveFieldCode) : true;
            if (!isWhenMatched) return;

            const hasAnyValue = rule.fields.some((fieldCode) => !isEmptyValue(values?.[fieldCode]));
            if (hasAnyValue) return;

            valid = false;
            const defaultMessage = `At least one of these fields is required: ${rule.fields.join(', ')}`;
            const message = rule.message || defaultMessage;
            rule.fields.forEach((fieldCode) => {
                newErrors[fieldCode] = message;
                newTouched.add(fieldCode);
            });
        });

        return {
            valid,
            newErrors,
            newTouched,
            nextAddMoreGroupErrors,
            nextRepeatablePageGroupErrors,
        };
    }, [
        addMoreValues,
        computedOverrides,
        conditionalAnyOfRules,
        getEffectiveAddMoreConstraint,
        hiddenAddMoreChildFieldIds.codes,
        hiddenAddMoreChildFieldIds.ids,
        pages,
        repeatablePageValues,
        resolveFieldCode,
        validateField,
        values,
    ]);

    const focusInvalidPage = useCallback((pageIndex: number) => {
        if (pageIndex !== activePageIndex) {
            setActivePageIndex(pageIndex);
            if (typeof window !== 'undefined') {
                window.requestAnimationFrame(() => {
                    window.requestAnimationFrame(() => {
                        scrollToFirstInvalidField();
                    });
                });
            }
            return;
        }

        scrollToFirstInvalidField();
    }, [activePageIndex, scrollToFirstInvalidField]);

    const ensurePagesValidThrough = useCallback((targetPageIndex: number) => {
        const safeTargetIndex = Math.min(targetPageIndex, pages.length - 1);

        for (let pageIndex = 0; pageIndex <= safeTargetIndex; pageIndex += 1) {
            const result = validatePageAtIndex(pageIndex);
            if (result.valid) continue;

            setTouched(result.newTouched);
            setErrors(result.newErrors);
            setAddMoreGroupErrors(result.nextAddMoreGroupErrors);
            setRepeatablePageGroupErrors(result.nextRepeatablePageGroupErrors);
            focusInvalidPage(pageIndex);
            return false;
        }

        return true;
    }, [focusInvalidPage, pages.length, validatePageAtIndex]);

    const handlePageNavigation = useCallback((pageIndex: number) => {
        if (pageIndex === activePageIndex || pageIndex < 0 || pageIndex >= pages.length) {
            return;
        }

        let canMove = true;
        if (pageIndex > activePageIndex) {
            canMove = ensurePagesValidThrough(pageIndex - 1);
        } else {
            canMove = ensurePagesValidThrough(activePageIndex);
        }

        if (!canMove) return;

        setActivePageIndex(pageIndex);
        setTouched(new Set());
        setErrors({});
        setAddMoreGroupErrors({});
        setRepeatablePageGroupErrors({});
    }, [activePageIndex, ensurePagesValidThrough, pages.length]);

    const handleChange = (code: string, val: any) => {
        if (readOnly) return;
        // Block direct editing of formula-computed fields
        if (formulaFields[code]) return;
        if (code === 'UK-FCL-03895_0') {
            const startValue = values?.['UK-FCL-03894_0'];
            if (startValue && val) {
                const startDate = new Date(startValue);
                const endDate = new Date(val);
                if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime()) && endDate < startDate) {
                    setErrors((prev) => ({
                        ...prev,
                        [code]: 'Project End Date cannot be earlier than Project Start Date.',
                    }));
                    return;
                }
            }
        }
        setAddMoreGroupErrors({});

        // Handle plugin field changes (supports both sync and async)
        const applyPluginResult = (pluginResult: any, next: any) => {
            if (pluginResult && typeof pluginResult === 'object' && !(pluginResult instanceof Promise)) {
                Object.assign(next, pluginResult);
            }
        };

        setValues(p => {
            const next = { ...p, [code]: val };

            // ── Apply plugin field changes (e.g., auto-copy address fields) ─────────
            if (plugin?.onFieldChange) {
                const pluginResult = plugin.onFieldChange(code, val, next);
                if (pluginResult instanceof Promise) {
                    // Handle async plugin result
                    pluginResult.then((asyncResult) => {
                        if (asyncResult && typeof asyncResult === 'object') {
                            setValues(current => {
                                const updated = { ...current };
                                Object.assign(updated, asyncResult);
                                return updated;
                            });
                        }
                    }).catch((error) => {
                        console.error('[FormRenderer] Plugin async error:', error);
                    });
                } else {
                    // Handle sync plugin result
                    if (pluginResult && typeof pluginResult === 'object') {
                        Object.assign(next, pluginResult);
                    }
                }
            }

            // Clear cascading children when parent changes (Country -> State -> District)
            // But NOT if this is just a label-to-value conversion for the same selection
            const oldVal = p[code];
            const isLabelConversion =
                typeof oldVal === 'string' &&
                oldVal.length > 0 &&
                typeof val === 'string' &&
                val.length > 0 &&
                oldVal !== val;

            // If this might be a label-to-value conversion, check if the field is a dropdown
            let shouldSkipClearingChildren = false;
            if (isLabelConversion) {
                const fieldMeta = allFields.find((f: any) => f.field_code === code);
                if (fieldMeta && (fieldMeta.master_code || fieldMeta.option_config?.master_table_id)) {
                    // This is a dropdown field converting label to value, preserve cascading children
                    shouldSkipClearingChildren = true;
                }
            }

            if (!shouldSkipClearingChildren) {
                const queue = [code];
                const visited = new Set<string>();
                while (queue.length) {
                    const changedCode = queue.shift()!;
                    if (visited.has(changedCode)) continue;
                    visited.add(changedCode);

                    allFields.forEach((f: any) => {
                        const pId = f?.option_config?.parent_builder_field_id;
                        if (!pId) return;
                        const pCode = fieldIdToCode.get(Number(pId));
                        if (pCode !== changedCode) return;
                        if (next[f.field_code] !== undefined) delete next[f.field_code];
                        queue.push(f.field_code);
                    });
                }
            }

            return next;
        });
        setTouched(p => new Set(p).add(code));
        const fieldMeta = allFields.find((f: any) => String(f?.field_code || '') === String(code || ''));
        const err = validateField(fieldMeta || { is_required: 'N', label: '' }, val, computedOverrides[String(code || '')]);
        setErrors((prev) => { const copy = { ...prev }; if (err) copy[code] = err; else delete copy[code]; return copy; });
    };

    const onNext = async () => {
        if (readOnly) {
            if (isLastPage) onCancel();
            else {
                setActivePageIndex(p => p + 1);
                if (typeof window !== 'undefined') {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            }
            return;
        }
        const isValid = ensurePagesValidThrough(activePageIndex);
        if (!isValid) {
            return;
        }

        if (isLastPage) {
            if (onSubmit) await onSubmit(values, addMoreValues, repeatablePageValues);
            return;
        }

        if (onSaveNext) {
            const result = await onSaveNext({
                values,
                addMoreValues,
                repeatablePageValues,
                currentPageIndex: activePageIndex,
                nextPageIndex: activePageIndex + 1,
            });
            if (result === false) return;
        }

        setCompletedPages(prev => new Set(prev).add(activePageIndex));
        setActivePageIndex(p => p + 1);
        if (typeof window !== 'undefined') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        setTouched(new Set());
        setErrors({});
    };

    const renderInput = (field: any, options?: { valueOverride?: any; onChangeOverride?: (value: any) => void; errorKey?: string }) => {
        const val = 'valueOverride' in (options || {}) ? options?.valueOverride : values[field.field_code];
        const errorKey = options?.errorKey ?? field.field_code;
        const hasErr = errors[errorKey] && (touched.has(errorKey) || touched.has(field.field_code) || touched.has('ALL_PAGE'));
        const css = `w-100 ${hasErr ? 'p-invalid' : ''}`;
        const ov = computedOverrides[field.field_code] || {};
        const isFormulaField = !!formulaFields[field.field_code];
        let disabled = readOnly || isFormulaField || ov.readonly === true || ov.editable === false || field.is_readonly === 'Y';

        const handleFieldValueChange = (nextValue: any) => {
            if (options?.onChangeOverride) {
                options.onChangeOverride(nextValue);
            } else {
                handleChange(field.field_code, nextValue);
            }
        };

        const handleFileUpload = async (file: File | null | undefined) => {
            if (readOnly || !file) return;
            const stateKey = String(field?.field_code || '');
            const uploaded = await uploadFormBuilderFile(field, file, stateKey);
            if (!uploaded) return;
            handleFieldValueChange(uploaded);
        };

        // Check plugin's isFieldReadonly override
        if (plugin?.isFieldReadonly) {
            const pluginReadonly = plugin.isFieldReadonly(field.field_code, values);
            if (pluginReadonly === true) {
                disabled = true;
            }
        }

        const placeholder = field.placeholder || '';
        const opts = Array.isArray(field.options) ? field.options : [];
        const inputType = String(field.input_type || 'text').toLowerCase().trim();

        // Formula fields: render as a styled read-only display showing prefix+value+suffix
        if (isFormulaField) {
            const displayVal = formulaDisplayValues[field.field_code] ?? '';
            return (
                <div
                    className={`form-control ${hasErr ? 'is-invalid' : ''}`}
                    style={{ background: '#f8f9fa', color: '#495057', cursor: 'not-allowed', minHeight: '38px', display: 'flex', alignItems: 'center', fontWeight: 500 }}
                >
                    {displayVal !== '' ? displayVal : <span style={{ color: '#adb5bd' }}>Auto-calculated</span>}
                </div>
            );
        }

        switch (inputType) {
            case 'textarea': return <InputTextarea className={css} value={val ?? ''} rows={3} onChange={(e) => { const next = e.target.value; if (typeof field.max_length === 'number' && next.length > field.max_length) { return; } handleFieldValueChange(next); }} disabled={disabled} placeholder={placeholder} />;
            case 'number': {
                const vRule = (typeof field.validation_rule === 'string' ? safeParseJSON(field.validation_rule) : field.validation_rule) || {};
                const maxDigits = typeof field.max_length === 'number' ? field.max_length : (typeof vRule.max_length === 'number' ? vRule.max_length : undefined);
                // When max_length is set: use InputText with digit-only filter — hard character limit
                if (maxDigits !== undefined) {
                    return <InputText
                        className={css}
                        value={val !== null && val !== undefined ? String(val) : ''}
                        onChange={(e) => {
                            const raw = e.target.value.replace(/\D/g, ''); // digits only
                            if (raw.length > maxDigits) return;            // hard block
                            handleFieldValueChange(raw === '' ? null : raw);
                        }}
                        onBlur={() => {
                            setTouched(prev => new Set(prev).add(field.field_code));
                            const err = validateField(field, values[field.field_code]);
                            setErrors(prev => { const c = { ...prev }; if (err) c[field.field_code] = err; else delete c[field.field_code]; return c; });
                        }}
                        disabled={disabled}
                        placeholder={placeholder}
                        inputMode="numeric"
                    />;
                }
                return <InputNumber className={css} value={val !== null && val !== undefined && val !== '' ? parseFloat(String(val)) : null} onValueChange={(e) => handleFieldValueChange(e.value)} disabled={disabled} useGrouping={false} placeholder={placeholder} />;
            }
            case 'select':
                if (field.option_config?.master_table_id) {
                    const pId = field.option_config?.parent_builder_field_id;
                    const pCode = pId ? fieldIdToCode.get(Number(pId)) : null;
                    const pVal = pCode ? values[pCode] : undefined;
                    return <DynamicFieldDropdown masterId={field.option_config.master_table_id} parentValue={pVal} value={val} onChange={(v: any) => handleFieldValueChange(v)} disabled={disabled} placeholder={placeholder || 'Select...'} className={css} appendTo={appendTo} />;
                }
                if (field.master_code) {
                    const pVal = field.parent_field_code ? values[field.parent_field_code] : undefined;
                    return <MasterDropdown masterCode={field.master_code} parentValue={pVal} value={val} onChange={(v: any) => handleFieldValueChange(v)} disabled={disabled} placeholder={placeholder || 'Select...'} className={css} appendTo={appendTo} />;
                }
                return <Dropdown className={css} value={val ? String(val) : null} options={opts} onChange={(e) => handleFieldValueChange(e.value)} disabled={disabled} placeholder={placeholder || 'Select...'} filter appendTo={appendTo} showClear />;
            case 'multiselect':
                if (field.option_config?.master_table_id) {
                    const pId = field.option_config?.parent_builder_field_id;
                    const pCode = pId ? fieldIdToCode.get(Number(pId)) : null;
                    const pVal = pCode ? values[pCode] : undefined;
                    return <DynamicFieldDropdown masterId={field.option_config.master_table_id} parentValue={pVal} value={val ?? []} onChange={(v: any) => handleFieldValueChange(v)} disabled={disabled} placeholder={placeholder || 'Select...'} className={css} appendTo={appendTo} isMulti />;
                }
                if (field.master_code) {
                    const pVal = field.parent_field_code ? values[field.parent_field_code] : undefined;
                    return <MasterDropdown masterCode={field.master_code} parentValue={pVal} value={val ?? []} onChange={(v: any) => handleFieldValueChange(v)} disabled={disabled} placeholder={placeholder || 'Select...'} className={css} appendTo={appendTo} isMulti />;
                }
                return <MultiSelect className={css} value={val ?? []} options={opts} onChange={(e) => handleFieldValueChange(e.value)} disabled={disabled} placeholder={placeholder || 'Select multiple...'} filter display="chip" appendTo={appendTo} />;
            case 'radio': return <div className="d-flex flex-wrap gap-4 mt-2">{opts.map((o: any) => <label key={o.value} className="d-flex align-items-center gap-2 cursor-pointer"><RadioButton name={field.field_code} value={String(o.value)} checked={String(val) === String(o.value)} onChange={(e) => handleFieldValueChange(e.value)} disabled={disabled} /><span className="fw-medium">{o.label}</span></label>)}</div>;
            case 'checkbox':
                if (opts.length > 0) {
                    const selectedValues = Array.isArray(val)
                        ? val.map((item: any) => String(item))
                        : isEmptyValue(val)
                            ? []
                            : [String(val)];
                    return (
                        <div className="d-flex flex-column gap-2 mt-2">
                            {opts.map((o: any, idx: number) => {
                                const optionValue = String(o?.value ?? o?.label ?? idx);
                                const isChecked = selectedValues.includes(optionValue);
                                return (
                                    <label key={`${field.field_code}_${optionValue}_${idx}`} className="d-flex align-items-start gap-2 cursor-pointer">
                                        <Checkbox
                                            inputId={`${field.field_code}_${idx}`}
                                            checked={isChecked}
                                            onChange={(e) => {
                                                const nextValues = e.checked
                                                    ? [...selectedValues, optionValue]
                                                    : selectedValues.filter((item) => item !== optionValue);
                                                handleFieldValueChange(nextValues);
                                            }}
                                            disabled={disabled}
                                        />
                                        <span className="fw-medium">{o?.label ?? optionValue}</span>
                                    </label>
                                );
                            })}
                        </div>
                    );
                }
                // Special handling for "Same as Above" checkbox - render with label on same line
                if (field.field_code === 'UK-FCL-03316_0' || field.field_code === 'UK-FCL-03120_0') {
                    return (
                        <label className="d-flex align-items-center gap-1 cursor-pointer">
                            <Checkbox checked={!!val} onChange={(e) => handleFieldValueChange(e.checked)} disabled={disabled} />
                            <span className="fw-medium">{field.label || 'Same as Above'}</span>
                        </label>
                    );
                }
                return <div className="mt-2"><Checkbox checked={!!val} onChange={(e) => handleFieldValueChange(e.checked)} disabled={disabled} /></div>;
            case 'date': {
                const rules = (typeof field.validation_rule === 'string' ? safeParseJSON(field.validation_rule) : field.validation_rule) || {};
                const { minDate, maxDate } = {
                    ...getDateValidationBounds('date', rules),
                    ...getProjectRegistrationDateBounds(String(field.field_code || ''), values),
                };
                return (
                    <Calendar
                        className={css}
                        value={parseDateValue(val)}
                        onChange={(e) => {
                            const newVal = e.value;
                            const formattedVal = newVal ? format(newVal, 'dd/MM/yyyy') : null;
                            // Create temporary values with the new date for validation context
                            const contextValues = { ...values, [field.field_code]: formattedVal };

                            // Call plugin validation directly with the updated context
                            let validationErr = '';
                            if (plugin?.validateField) {
                                validationErr = plugin.validateField(String(field.field_code || ''), formattedVal, contextValues) || '';
                            }

                            if (validationErr) {
                                // Validation failed - clear the field and show error
                                setTouched(prev => new Set(prev).add(field.field_code));
                                setErrors(prev => ({ ...prev, [field.field_code]: validationErr }));
                                handleFieldValueChange(null);
                            } else {
                                // Validation passed - set the value normally
                                handleFieldValueChange(formattedVal);
                                // Clear any existing error for this field
                                setErrors(prev => {
                                    const updatedErr = { ...prev };
                                    delete updatedErr[field.field_code];
                                    return updatedErr;
                                });
                            }
                        }}
                        showIcon
                        disabled={disabled}
                        placeholder={placeholder}
                        minDate={minDate}
                        maxDate={maxDate}
                        dateFormat="dd/mm/yy"
                        locale="en"
                    />
                );
            }
            case 'datetime-local': {
                const rules = (typeof field.validation_rule === 'string' ? safeParseJSON(field.validation_rule) : field.validation_rule) || {};
                const { minDate, maxDate } = getDateValidationBounds('datetime-local', rules);
                return <Calendar className={css} value={parseDateValue(val)} onChange={(e) => handleFieldValueChange(e.value ? format(e.value, 'dd/MM/yyyy HH:mm') : null)} showIcon showTime disabled={disabled} placeholder={placeholder} minDate={minDate} maxDate={maxDate} dateFormat="dd/mm/yy" locale="en" />;
            }
            case 'file': {
                const rules = (typeof field.validation_rule === 'string' ? safeParseJSON(field.validation_rule) : field.validation_rule) || {};
                const fileKey = String(field.field_code || '');
                const storedPath = getStoredFilePath(val);
                const storedName = getStoredFileName(val);
                const isUploading = Boolean(uploadingFileByKey[fileKey]);
                const uploadError = fileUploadErrorByKey[fileKey];
                if (readOnly) {
                    return storedPath ? (
                        <a href={resolveFileUrl(storedPath)} target="_blank" rel="noreferrer" className="text-primary text-decoration-underline d-inline-flex align-items-center gap-1">
                            <i className="pi pi-paperclip" />
                            {storedName || 'View uploaded file'}
                        </a>
                    ) : (
                        <small className="text-muted">No file uploaded</small>
                    );
                }
                return (
                    <div className="d-flex flex-column gap-1">
                        <input
                            type="file"
                            className={`form-control ${css}`}
                            accept={rules.accept || '*'}
                            onChange={(e) => handleFileUpload(e.target.files?.[0] || null)}
                            disabled={disabled || isUploading}
                        />
                        {isUploading && <small className="text-muted"><i className="pi pi-spin pi-spinner me-1" /> Uploading...</small>}
                        {!isUploading && storedPath && (
                            <a href={resolveFileUrl(storedPath)} target="_blank" rel="noreferrer" className="text-primary text-decoration-underline d-inline-flex align-items-center gap-1">
                                <i className="pi pi-paperclip" />
                                {storedName || 'View uploaded file'}
                            </a>
                        )}
                        {!isUploading && !storedPath && val instanceof File && <small className="text-success fw-bold"><i className="pi pi-check-circle me-1" /> {val.name}</small>}
                        {!!uploadError && <small className="text-danger">{uploadError}</small>}
                    </div>
                );
            }
            case 'button': {
                const rules = (typeof field.validation_rule === 'string' ? safeParseJSON(field.validation_rule) : field.validation_rule) || {};
                const actionCode = String(rules.action_code || '').toUpperCase();
                const style = ACTION_BUTTON_STYLES[actionCode] || { bg: '#6b7280', border: '#4b5563' };
                const label = field.custom_label || field.label || actionCode || 'Action';
                return (
                    <button
                        type="button"
                        onClick={() => onActionButton?.(actionCode)}
                        disabled={readOnly || !onActionButton}
                        style={{ backgroundColor: style.bg, borderColor: style.border, color: '#fff', border: '1px solid', borderRadius: 6, padding: '8px 20px', fontWeight: 600, cursor: onActionButton ? 'pointer' : 'default', opacity: (!onActionButton) ? 0.7 : 1 }}
                    >
                        {label}
                    </button>
                );
            }
            default: return <InputText className={css} value={val ?? ''} onChange={(e) => { const next = e.target.value; if (typeof field.max_length === 'number' && next.length > field.max_length) { return; } handleFieldValueChange(next); }} disabled={disabled} placeholder={placeholder} />;
        }
    };

    const addRow = (gId: number, maxRows: number | null, columns: any[] = []) => {
        setAddMoreValues(prev => {
            const current = prev[gId] || [];
            const dynamic = getEffectiveAddMoreConstraint(gId, 'add');
            const enforcedMax =
                dynamic?.mode === 'exact' || dynamic?.mode === 'max'
                    ? Number(dynamic.expectedRows)
                    : null;
            const finalMax = enforcedMax !== null && Number.isFinite(enforcedMax) && enforcedMax > 0
                ? enforcedMax
                : (maxRows && maxRows > 0 ? maxRows : null);
            if (finalMax !== null && current.length >= finalMax) {
                const message =
                    dynamic?.message ||
                    (dynamic?.mode === 'exact'
                        ? `You can add exactly ${finalMax} row(s).`
                        : `You can add maximum ${finalMax} row(s).`);
                setAddMoreGroupErrors((prevErr) => ({ ...prevErr, [gId]: message }));
                return prev;
            }
            setAddMoreGroupErrors((prevErr) => {
                if (!prevErr[gId]) return prevErr;
                const next = { ...prevErr };
                delete next[gId];
                return next;
            });
            return {
                ...prev,
                [gId]: [...current, buildDefaultValuesForFields(columns || [])],
            };
        });
    };

    const removeRow = (gId: number, rIdx: number, minRows: number) => {
        setAddMoreValues(prev => {
            const current = prev[gId] || [];
            const dynamic = getEffectiveAddMoreConstraint(gId, 'add');
            const dynamicMin = dynamic?.mode === 'exact' || dynamic?.mode === 'min'
                ? Number(dynamic.expectedRows)
                : null;
            const finalMin = Number.isFinite(Number(dynamicMin))
                ? Number(dynamicMin)
                : Number(minRows);
            if (current.length <= finalMin) {
                const message =
                    dynamic?.message ||
                    (dynamic?.mode === 'exact'
                        ? `At least ${finalMin} row(s) required.`
                        : `Minimum ${finalMin} row(s) required.`);
                setAddMoreGroupErrors((prevErr) => ({ ...prevErr, [gId]: message }));
                return prev;
            }
            setAddMoreGroupErrors((prevErr) => {
                if (!prevErr[gId]) return prevErr;
                const next = { ...prevErr };
                delete next[gId];
                return next;
            });
            return { ...prev, [gId]: current.filter((_, i) => i !== rIdx) };
        });
    };

    const onAddMoreCellChange = (groupId: number, rowIndex: number, column: any, nextValue: any, groupColumns: any[]) => {
        if (readOnly) return;
        const key = column.field_code;
        setAddMoreGroupErrors((prev) => {
            if (!prev[groupId]) return prev;
            const next = { ...prev };
            delete next[groupId];
            return next;
        });

        setAddMoreValues(prev => {
            const rows = [...(prev[groupId] || [])];
            if (!rows[rowIndex]) return prev;

            const updatedRow = { ...rows[rowIndex], [key]: nextValue };

            groupColumns.forEach(childCol => {
                if (childCol.option_config?.parent_builder_field_id === column.builder_field_id) {
                    delete updatedRow[childCol.field_code];
                }
            });

            rows[rowIndex] = updatedRow;
            return { ...prev, [groupId]: rows };
        });
        setTouched(p => new Set(p).add(`${groupId}_${rowIndex}_${key}`));
    };

    const clearFileUploadError = useCallback((key: string) => {
        setFileUploadErrorByKey((prev) => {
            if (!prev[key]) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
        });
    }, []);

    const uploadFormBuilderFile = useCallback(async (
        field: any,
        file: File | null | undefined,
        stateKey: string,
        meta?: { groupId?: number; rowIndex?: number },
    ) => {
        if (!file) return null;

        const validationError = validateField(field, file);
        if (validationError) {
            setFileUploadErrorByKey((prev) => ({ ...prev, [stateKey]: validationError }));
            return null;
        }

        try {
            setUploadingFileByKey((prev) => ({ ...prev, [stateKey]: true }));
            clearFileUploadError(stateKey);

            const form = new FormData();
            form.append('serviceId', String(serviceId || ''));
            if (submissionId) form.append('submissionId', String(submissionId));
            form.append('fieldCode', String(field?.field_code || ''));
            if (meta?.groupId !== undefined) form.append('groupId', String(meta.groupId));
            if (meta?.rowIndex !== undefined) form.append('rowIndex', String(meta.rowIndex));
            form.append('file', file);

            const res = await apiClient.post('/common/documents/form-builder-upload', form);
            return res?.data?.data || null;
        } catch (e: any) {
            const message = e?.response?.data?.message || e?.message || 'Upload failed. Please try again.';
            setFileUploadErrorByKey((prev) => ({ ...prev, [stateKey]: String(message) }));
            return null;
        } finally {
            setUploadingFileByKey((prev) => {
                if (!prev[stateKey]) return prev;
                const next = { ...prev };
                delete next[stateKey];
                return next;
            });
        }
    }, [clearFileUploadError, serviceId, submissionId, validateField]);

    const handleFileFieldUpload = useCallback(async (field: any, file?: File | null) => {
        if (readOnly || !file) return;
        const stateKey = String(field?.field_code || '');
        const uploaded = await uploadFormBuilderFile(field, file, stateKey);
        if (!uploaded) return;
        handleChange(String(field.field_code || ''), uploaded);
    }, [handleChange, readOnly, uploadFormBuilderFile]);

    const handleAddMoreFileFieldUpload = useCallback(async (
        groupId: number,
        rowIndex: number,
        column: any,
        file: File | null | undefined,
        groupColumns: any[],
    ) => {
        if (readOnly || !file) return;
        const stateKey = `${groupId}_${rowIndex}_${String(column?.field_code || '')}`;
        const uploaded = await uploadFormBuilderFile(column, file, stateKey, { groupId, rowIndex });
        if (!uploaded) return;
        onAddMoreCellChange(groupId, rowIndex, column, uploaded, groupColumns);
    }, [onAddMoreCellChange, readOnly, uploadFormBuilderFile]);

    const renderAddMoreColumnInput = (groupId: number, rowIndex: number, col: any, rowValues: Record<string, any>, groupColumns: any[]) => {
        const key = col.field_code;
        const value = rowValues[key];
        const disabled = readOnly || col.is_readonly === 'Y';
        const fieldKey = `${groupId}_${rowIndex}_${key}`;
        const err = validateField(col, value);
        const showErr = Boolean(err) && (touched.has(fieldKey) || touched.has('ALL_PAGE'));
        const css = `w-100 ${showErr ? 'p-invalid' : ''}`;
        const pluginFieldMeta = plugin?.getFieldMeta?.(col.field_code, values) ?? {};
        const columnHelpText = String(pluginFieldMeta.helperText ?? col?.help_text ?? col?.helpText ?? '').trim() || undefined;
        const columnHelpTextStyle = pluginFieldMeta.helperTextStyle;
        const helpTextClassName = columnHelpTextStyle ? 'd-block mt-1' : columnHelpText && /should be above/i.test(columnHelpText)
            ? 'text-danger'
            : 'text-muted';

        const renderAddMoreFieldMeta = () => (
            <>
                {showErr ? <small className="text-danger d-block mt-1">{err}</small> : null}
                {columnHelpText ? (
                    <small className={`${helpTextClassName}`} style={{ fontSize: '0.82rem', ...(columnHelpTextStyle || {}) }}>
                        {columnHelpText}
                    </small>
                ) : null}
            </>
        );

        const isCascading = !!col.option_config?.master_table_id;
        if (isCascading) {
            let parentValue = undefined;
            if (col.option_config?.parent_builder_field_id) {
                const parentCodeObj = groupColumns.find(c => c.builder_field_id === col.option_config.parent_builder_field_id);
                if (parentCodeObj) {
                    parentValue = rowValues[parentCodeObj.field_code];
                    if (parentValue === undefined) parentValue = values[parentCodeObj.field_code];
                }
            }

            const isMulti = col.input_type === 'multiselect';
            return (
                <div>
                    <AddMoreDynamicDropdown
                        masterId={col.option_config.master_table_id}
                        parentValue={parentValue}
                        value={value}
                        onChange={(v: any) => onAddMoreCellChange(groupId, rowIndex, col, v, groupColumns)}
                        disabled={disabled}
                        placeholder={col.placeholder || "Select"}
                        className={css}
                        appendTo={appendTo}
                        isMulti={isMulti}
                    />
                    {renderAddMoreFieldMeta()}
                </div>
            );
        }

        const rawOpts = safeParseJSON(col.options);
        const opts = Array.isArray(rawOpts)
            ? rawOpts.map((o: any) => ({ label: o?.label ?? o?.name ?? String(o?.value ?? ''), value: String(o?.value ?? '') }))
            : [];
        const inputType = String(col.input_type || 'text').toLowerCase().trim();

        if (col.master_code && (inputType === 'select' || inputType === 'multiselect')) {
            const parentVal = col.parent_field_code ? (rowValues[col.parent_field_code] ?? values[col.parent_field_code]) : undefined;
            return (
                <div>
                    <MasterDropdown
                        masterCode={col.master_code}
                        parentValue={parentVal}
                        value={inputType === 'multiselect' ? (value ?? []) : value}
                        onChange={(v: any) => onAddMoreCellChange(groupId, rowIndex, col, v, groupColumns)}
                        disabled={disabled}
                        placeholder={col.placeholder || 'Select'}
                        className={css}
                        appendTo={appendTo}
                        isMulti={inputType === 'multiselect'}
                    />
                    {renderAddMoreFieldMeta()}
                </div>
            );
        }

        switch (inputType) {
            case 'textarea': return (
                <div>
                    <InputTextarea className={css} value={value ?? ''} onChange={e => onAddMoreCellChange(groupId, rowIndex, col, e.target.value, groupColumns)} disabled={disabled} placeholder={col.placeholder} rows={2} autoResize />
                    {renderAddMoreFieldMeta()}
                </div>
            );
            case 'number': {
                const vRule = (typeof col.validation_rule === 'string' ? safeParseJSON(col.validation_rule) : col.validation_rule) || {};
                const maxDigits = typeof col.max_length === 'number' ? col.max_length : (typeof vRule.max_length === 'number' ? vRule.max_length : undefined);
                if (maxDigits !== undefined) {
                    return (
                        <div>
                            <InputText
                                className={css}
                                value={value !== null && value !== undefined ? String(value) : ''}
                                onChange={e => {
                                    const raw = e.target.value.replace(/\D/g, '');
                                    if (raw.length > maxDigits) return;
                                    onAddMoreCellChange(groupId, rowIndex, col, raw === '' ? null : raw, groupColumns);
                                }}
                                disabled={disabled}
                                placeholder={col.placeholder}
                                inputMode="numeric"
                            />
                            {renderAddMoreFieldMeta()}
                        </div>
                    );
                }
                return (
                    <div>
                        <InputNumber className={css} value={value !== null && value !== undefined && value !== '' ? Number(value) : null} onValueChange={e => onAddMoreCellChange(groupId, rowIndex, col, e.value, groupColumns)} disabled={disabled} useGrouping={false} placeholder={col.placeholder} />
                        {renderAddMoreFieldMeta()}
                    </div>
                );
            }
            case 'date': {
                const rules = (typeof col.validation_rule === 'string' ? safeParseJSON(col.validation_rule) : col.validation_rule) || {};
                const { minDate, maxDate } = getDateValidationBounds('date', rules);
                return (
                    <div>
                        <Calendar className={css} value={parseDateValue(value)} onChange={e => onAddMoreCellChange(groupId, rowIndex, col, e.value ? format(e.value, 'dd/MM/yyyy') : null, groupColumns)} disabled={disabled} showIcon placeholder={col.placeholder} minDate={minDate} maxDate={maxDate} dateFormat="dd/mm/yy" locale="en" />
                        {renderAddMoreFieldMeta()}
                    </div>
                );
            }
            case 'datetime-local': {
                const rules = (typeof col.validation_rule === 'string' ? safeParseJSON(col.validation_rule) : col.validation_rule) || {};
                const { minDate, maxDate } = getDateValidationBounds('datetime-local', rules);
                return (
                    <div>
                        <Calendar className={css} value={parseDateValue(value)} onChange={e => onAddMoreCellChange(groupId, rowIndex, col, e.value ? format(e.value, 'dd/MM/yyyy HH:mm') : null, groupColumns)} disabled={disabled} showIcon showTime placeholder={col.placeholder} minDate={minDate} maxDate={maxDate} dateFormat="dd/mm/yy" locale="en" />
                        {renderAddMoreFieldMeta()}
                    </div>
                );
            }
            case 'select': return (
                <div>
                    <Dropdown className={css} value={value ? String(value) : null} options={opts} onChange={e => onAddMoreCellChange(groupId, rowIndex, col, e.value, groupColumns)} disabled={disabled} placeholder={col.placeholder || "Select"} filter appendTo={appendTo} showClear />
                    {renderAddMoreFieldMeta()}
                </div>
            );
            case 'multiselect': return (
                <div>
                    <MultiSelect className={css} value={value ?? []} options={opts} onChange={e => onAddMoreCellChange(groupId, rowIndex, col, e.value, groupColumns)} disabled={disabled} placeholder={col.placeholder || "Select"} filter display="chip" appendTo={appendTo} />
                    {renderAddMoreFieldMeta()}
                </div>
            );
            case 'checkbox': return (
                <div>
                    <Checkbox checked={Boolean(value)} onChange={e => onAddMoreCellChange(groupId, rowIndex, col, e.checked, groupColumns)} disabled={disabled} />
                    {renderAddMoreFieldMeta()}
                </div>
            );
            case 'file': {
                const rules = (typeof col.validation_rule === 'string' ? safeParseJSON(col.validation_rule) : col.validation_rule) || {};
                const storedPath = getStoredFilePath(value);
                const storedName = getStoredFileName(value);
                const isUploading = Boolean(uploadingFileByKey[fieldKey]);
                const uploadError = fileUploadErrorByKey[fieldKey];
                if (readOnly) {
                    return (
                        <div className="d-flex flex-column gap-1">
                            {storedPath ? (
                                <a href={resolveFileUrl(storedPath)} target="_blank" rel="noreferrer" className="text-primary text-decoration-underline d-inline-flex align-items-center gap-1">
                                    <i className="pi pi-paperclip" />
                                    {storedName || 'View uploaded file'}
                                </a>
                            ) : (
                                <small className="text-muted">No file uploaded</small>
                            )}
                            {renderAddMoreFieldMeta()}
                        </div>
                    );
                }
                return (
                    <div className="d-flex flex-column gap-1">
                        <input
                            type="file"
                            className={`form-control ${css}`}
                            accept={rules.accept || '*'}
                            onChange={(e) => handleAddMoreFileFieldUpload(groupId, rowIndex, col, e.target.files?.[0] || null, groupColumns)}
                            disabled={disabled || isUploading}
                        />
                        {isUploading && <small className="text-muted"><i className="pi pi-spin pi-spinner me-1" /> Uploading...</small>}
                        {!isUploading && storedPath && (
                            <a href={resolveFileUrl(storedPath)} target="_blank" rel="noreferrer" className="text-primary text-decoration-underline d-inline-flex align-items-center gap-1">
                                <i className="pi pi-paperclip" />
                                {storedName || 'View uploaded file'}
                            </a>
                        )}
                        {!isUploading && !storedPath && value instanceof File && <small className="text-success fw-bold"><i className="pi pi-check-circle me-1" /> {value.name}</small>}
                        {!!uploadError && <small className="text-danger d-block">{uploadError}</small>}
                        {renderAddMoreFieldMeta()}
                    </div>
                );
            }
            default: return (
                <div>
                    <InputText className={css} value={value ?? ''} onChange={e => onAddMoreCellChange(groupId, rowIndex, col, e.target.value, groupColumns)} disabled={disabled} placeholder={col.placeholder} />
                    {renderAddMoreFieldMeta()}
                </div>
            );
        }
    };

    // NOTE: renderAddMoreGroup function removed (unused) - use renderAddMoreGroupCompact instead

    const addRepeatablePageRow = (repeatablePageId: number, config: any) => {
        setRepeatablePageValues(prev => {
            const current = prev[repeatablePageId] || [];
            const maxRows = evaluateFormulaSync(config.max_rows_formula || '', values)?.value ?? config.max_rows;
            if (typeof maxRows === 'number' && current.length >= maxRows) {
                return prev;
            }
            const template = buildDefaultValuesForFields(
                (config.categories || []).flatMap((cat: any) => cat.fields || [])
            );
            return {
                ...prev,
                [repeatablePageId]: [...current, { ...template }],
            };
        });
    };

    const removeRepeatablePageRow = (repeatablePageId: number, rowIndex: number, config: any) => {
        setRepeatablePageValues(prev => {
            const current = prev[repeatablePageId] || [];
            const minRows = evaluateFormulaSync(config.min_rows_formula || '', values)?.value ?? config.min_rows ?? 1;
            if (current.length <= minRows) {
                return prev;
            }
            return {
                ...prev,
                [repeatablePageId]: current.filter((_, i) => i !== rowIndex),
            };
        });
    };

    const updateRepeatablePageRow = (repeatablePageId: number, rowIndex: number, fieldCode: string, value: any) => {
        setRepeatablePageValues(prev => {
            const current = prev[repeatablePageId] || [];
            const newRows = [...current];
            newRows[rowIndex] = { ...(newRows[rowIndex] || {}), [fieldCode]: value };
            return { ...prev, [repeatablePageId]: newRows };
        });
    };

    const handleOpenImportModal = (repeatablePageConfigId: number, type: ImportType) => {
        setImportingRepeatablePageConfigId(repeatablePageConfigId);
        setImportType(type);
        setShowImportModal(true);
    };

    const handleImportCSV = (csvData: any[], config: any) => {
        // Build field info map from repeatable page config
        const fieldInfoMap = buildFieldInfoMap(config);

        // Get import type from current state
        const currentImportType = importType as ImportType;

        // Convert CSV rows to field values
        const newRows = csvData.map((csvRow) => {
            const converted = convertCSVRowToFieldValues(csvRow, currentImportType, fieldInfoMap);
            return converted;
        });

        // Update repeatable page values - ALWAYS REPLACE existing data with CSV data
        setRepeatablePageValues(prev => {
            const updated = {
                ...prev,
                [config.id]: newRows,
            };
            return updated;
        });

        // Close modal
        setShowImportModal(false);
        setImportType(null);
        setImportingRepeatablePageConfigId(null);
    };

    const renderRepeatablePageSection = (field: any) => {
        const config = field.repeatable_page_config || {};
        const rows = repeatablePageValues[config.id] || [];

        // Resolve min_rows: formula first, then explicit value, default to 0
        let minRows = 0;
        if (config.min_rows_formula) {
            const formulaResult = evaluateFormulaSync(config.min_rows_formula, values);
            minRows = Number(formulaResult?.value ?? 0) || 0;
        } else if (config.min_rows !== null && config.min_rows !== undefined) {
            minRows = Math.max(0, Number(config.min_rows) || 0);
        }

        const maxRows = evaluateFormulaSync(config.max_rows_formula || '', values)?.value ?? config.max_rows;
        const canAdd = !maxRows || rows.length < maxRows;
        const canRemove = rows.length > minRows;

        const renderRowField = (rowField: any, rowIndex: number) => {
            const fieldCode = String(rowField.field_code || rowField.id || '');
            if (!fieldCode) return null; // Skip if no valid field identifier

            const val = rows[rowIndex]?.[fieldCode];
            const visible = computedOverrides[fieldCode]?.visible ?? true;
            if (!visible) return null;

            const required = computedOverrides[fieldCode]?.required ?? rowField.is_required === 'Y';
            const rowErrorKey = `rep_${config.id}_${rowIndex}_${fieldCode}`;
            const rowTouchedKey = `rep_${config.id}_${rowIndex}_${fieldCode}`;
            const handleChange = (nextValue: any) => {
                updateRepeatablePageRow(config.id, rowIndex, fieldCode, nextValue);
                setTouched((prev) => new Set(prev).add(rowTouchedKey));

                const err = validateField(rowField, nextValue, computedOverrides[String(fieldCode)]);
                setErrors((prev) => {
                    const copy = { ...prev };
                    if (err) copy[rowErrorKey] = err;
                    else delete copy[rowErrorKey];
                    return copy;
                });
            };

            const hasRowError = Boolean(errors[rowErrorKey] && (touched.has(rowTouchedKey) || touched.has('ALL_PAGE')));

            // Get DMS documents for this field
            const inlineDocs = docsForField(fieldCode);

            return (
                <div key={`rep-field-${config.id}-${rowIndex}-${rowField.id}`} className="d-flex flex-column">
                    <label className="form-label fw-semibold text-secondary m-0 mb-2" style={{ fontSize: '0.95rem' }}>
                        {rowField.label}
                        {required && !readOnly && <span className="text-danger ms-1">*</span>}
                    </label>
                    <div className="field-input-with-upload d-flex align-items-stretch flex-grow-1 input-wrap-mica" style={{ minHeight: '40px' }}>
                        <div className="field-input-holder w-100">
                            {renderInput({ ...rowField, field_code: fieldCode }, {
                                onChangeOverride: handleChange,
                                valueOverride: val,
                                errorKey: rowErrorKey,
                            })}
                        </div>
                        {inlineDocs.length > 0 && (
                            <div className="d-flex align-items-stretch gap-0 upload-affix-group">
                                {inlineDocs.map((doc: any) => {
                                    const isUploading = uploadingDocId === Number(doc.id);
                                    const isDisabled = isUploading || isSubmitting;
                                    const inputId = `inline-upload-rep-${config.id}-${rowIndex}-${fieldCode}-${doc.id}`;
                                    const allowedExts = normalizeAllowedFormats(doc?.allowedFormats);
                                    const acceptAttr = allowedExts.join(',');
                                    return (
                                        <div key={`inline-doc-icon-rep-${config.id}-${rowIndex}-${fieldCode}-${doc.id}`}>
                                            {!readOnly && (
                                                <>
                                                    <input
                                                        id={inputId}
                                                        type="file"
                                                        className="d-none"
                                                        accept={acceptAttr || undefined}
                                                        onChange={(e) => handleInlineDocumentUpload(Number(doc.id), e.target.files?.[0] || null)}
                                                        disabled={isDisabled}
                                                    />
                                                    <label
                                                        htmlFor={inputId}
                                                        className="d-inline-flex align-items-center justify-content-center border upload-affix-btn"
                                                        style={{
                                                            cursor: isDisabled ? 'not-allowed' : 'pointer',
                                                            borderColor: '#d9dee7',
                                                            background: isDisabled ? '#f3f4f6' : '#fff5f5',
                                                            color: isDisabled ? '#9ca3af' : '#dc2626',
                                                            opacity: isDisabled ? 0.8 : 1,
                                                            marginBottom: 0,
                                                        }}
                                                        title={isUploading ? 'Uploading...' : 'Upload document'}
                                                    >
                                                        <i className={isUploading ? 'pi pi-spin pi-spinner' : 'pi pi-upload'} style={{ fontSize: '0.85rem' }} />
                                                    </label>
                                                </>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    {hasRowError && (
                        <small className="text-danger d-block mt-2 fw-medium">
                            <i className="pi pi-exclamation-circle me-1"></i>
                            {errors[rowErrorKey]}
                        </small>
                    )}
                    {inlineDocs.length > 0 && (
                        <div className="mt-2 d-flex flex-column gap-1">
                            {inlineDocs.map((doc: any) => {
                                const allowedExts = normalizeAllowedFormats(doc?.allowedFormats);
                                const uploaded = uploadedDocByChecklistId[Number(doc.id)];
                                return (
                                    <div key={`inline-doc-meta-rep-${config.id}-${rowIndex}-${fieldCode}-${doc.id}`} className="d-flex flex-column align-items-start gap-1">
                                        <div className="d-flex align-items-center gap-2 flex-wrap">
                                            <small className={uploaded?.filePath ? 'text-success' : 'text-muted'} style={{ fontSize: '0.72rem' }}>
                                                {doc?.name || `Document ${doc?.id}`}: {uploaded?.filePath ? 'Uploaded' : 'Not uploaded'}
                                            </small>
                                            {allowedExts.length > 0 && (
                                                <small className="text-muted" style={{ fontSize: '0.7rem' }}>
                                                    Allowed: {allowedExts.join(', ')}
                                                </small>
                                            )}
                                            {!!uploadErrorByChecklistId[Number(doc.id)] && (
                                                <small className="text-danger" style={{ fontSize: '0.72rem' }}>
                                                    {uploadErrorByChecklistId[Number(doc.id)]}
                                                </small>
                                            )}
                                        </div>
                                        {uploaded?.filePath && (
                                            <a
                                                href={resolveFileUrl(uploaded.filePath)}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-primary text-decoration-underline d-inline-flex align-items-center gap-1"
                                                style={{ fontSize: '0.78rem', fontWeight: 600 }}
                                            >
                                                <i className="pi pi-external-link" style={{ fontSize: '0.72rem' }} />
                                                View uploaded file
                                            </a>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            );
        };

        return (
            <div className="mb-4">
                {/* Import button for service 12235.0 */}
                {!readOnly && serviceId === '12235.0' && config?.id && (
                    <div className="d-flex gap-2 mb-4">
                        {field.label?.toLowerCase().includes('doctor') || field.label?.toLowerCase().includes('physician') ? (
                            <button
                                type="button"
                                onClick={() => handleOpenImportModal(config.id, 'doctor')}
                                disabled={isSubmitting}
                                className="border rounded-2 px-4 py-2 fw-medium"
                                style={{
                                    borderColor: '#8B2020',
                                    color: '#8B2020',
                                    background: '#fff5f5',
                                    minWidth: 160,
                                }}
                                title="Import doctor details from CSV"
                            >
                                <i className="pi pi-download me-2" />
                                Import Doctor
                            </button>
                        ) : field.label?.toLowerCase().includes('nurse') ? (
                            <button
                                type="button"
                                onClick={() => handleOpenImportModal(config.id, 'nurse')}
                                disabled={isSubmitting}
                                className="border rounded-2 px-4 py-2 fw-medium"
                                style={{
                                    borderColor: '#8B2020',
                                    color: '#8B2020',
                                    background: '#fff5f5',
                                    minWidth: 160,
                                }}
                                title="Import nurse details from CSV"
                            >
                                <i className="pi pi-download me-2" />
                                Import Nurse
                            </button>
                        ) : null}
                    </div>
                )}

                {rows.length === 0 ? (
                    <div className="text-muted">No entries added yet.</div>
                ) : rows.map((row: any, rowIndex: number) => (
                    <div
                        key={`rep-row-${config.id}-${rowIndex}`}
                        className="border rounded-3 p-4 mb-4"
                        style={{ borderColor: '#e5e7eb', background: '#fafafa' }}
                    >
                        <div className="d-flex align-items-center justify-content-between mb-3 pb-3" style={{ borderBottom: '1px solid #e5e7eb' }}>
                            <div className="d-flex align-items-center gap-2">
                                <span
                                    className="fw-semibold text-white rounded-circle d-flex align-items-center justify-content-center"
                                    style={{ width: '28px', height: '28px', fontSize: '0.85rem', background: '#2E7D32' }}
                                >
                                    {rowIndex + 1}
                                </span>
                                <span className="fw-medium text-secondary">
                                    {field.label || 'Entry'} #{rowIndex + 1}
                                </span>
                            </div>
                            {!readOnly && canRemove && (
                                <button
                                    type="button"
                                    onClick={() => removeRepeatablePageRow(config.id, rowIndex, config)}
                                    className="border-0 bg-transparent text-danger cursor-pointer"
                                    title="Delete this entry"
                                    style={{ padding: '4px 8px' }}
                                >
                                    <i className="pi pi-trash" style={{ fontSize: '1rem' }} />
                                </button>
                            )}
                        </div>

                        <div className="row g-3">
                            {(config.categories || []).map((cat: any) => (
                                cat.fields && cat.fields.length > 0 ? (
                                    <div key={`rep-cat-${config.id}-${rowIndex}-${cat.id}`} className="col-12">
                                        <div className="rounded-3 p-3 mb-3" style={{ background: '#ffffff', border: '1px solid #e5e7eb' }}>
                                            <h6 className="fw-semibold text-secondary mb-3" style={{ fontSize: '0.95rem' }}>
                                                {cat.name}
                                            </h6>
                                            <div className="row g-3">
                                                {cat.fields.map((catField: any) => (
                                                    <div
                                                        key={`rep-cat-field-${config.id}-${rowIndex}-${cat.id}-${catField.id}`}
                                                        className={`col-12 ${BOOTSTRAP_SPANS[catField.grid_span || 12]}`}
                                                    >
                                                        {renderRowField(catField, rowIndex)}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ) : null
                            ))}
                        </div>
                    </div>
                ))}

                {!readOnly && (
                    <div className="d-flex align-items-center gap-3 flex-wrap mt-2">
                        <button
                            type="button"
                            onClick={() => addRepeatablePageRow(config.id, config)}
                            disabled={!canAdd}
                            className="border bg-white rounded-2 px-4 py-2 fw-medium"
                            style={{
                                borderColor: canAdd ? '#efcaca' : '#e5e7eb',
                                color: canAdd ? '#ef4444' : '#9ca3af',
                                minWidth: 180,
                                opacity: canAdd ? 1 : 0.6,
                            }}
                        >
                            <i className="pi pi-plus me-2" />
                            Add {field.label || 'Entry'}
                        </button>
                        {repeatablePageGroupErrors[config.id] && (
                            <small className="text-danger">{repeatablePageGroupErrors[config.id]}</small>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const renderAddMoreGroupCompact = (group: any, parentFieldLabel: string) => {
        const rows = addMoreValues[group.id] || [];
        const columns = [...(group.columns || [])].sort((a: any, b: any) => (a.col_order ?? a.preference ?? 0) - (b.col_order ?? b.preference ?? 0));
        const maxRows = typeof group.max_rows === 'number' && group.max_rows > 0 ? group.max_rows : null;
        const minRows = Math.max(1, Number(group.min_rows || 0));
        const dynamic = getEffectiveAddMoreConstraint(group.id, 'add');
        const dynamicMax = dynamic?.mode === 'exact' || dynamic?.mode === 'max' ? Number(dynamic.expectedRows) : null;
        const dynamicMin = dynamic?.mode === 'exact' || dynamic?.mode === 'min' ? Number(dynamic.expectedRows) : null;
        const finalMax = dynamicMax !== null && Number.isFinite(dynamicMax) && dynamicMax > 0 ? dynamicMax : maxRows;
        const finalMin = dynamicMin !== null && Number.isFinite(dynamicMin) ? dynamicMin : minRows;

        let displayLabel = group.label || 'Add Entry';
        if (displayLabel.toLowerCase().includes('add more')) {
            displayLabel = parentFieldLabel || 'Add Entry';
        }

        return (
            <div key={`compact-${group.id}`} className="mt-2 mb-4">
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                    <div className="fw-semibold text-dark" style={{ fontSize: '1rem' }}>{displayLabel}</div>
                    <small className="text-muted">
                        Rows mapped: {rows.length}{typeof finalMax === 'number' ? ` / ${finalMax}` : ''}
                    </small>
                </div>

                <div className="border rounded-3 bg-white overflow-auto" style={{ borderColor: '#d9dee7' }}>
                    <table className="table mb-0 align-middle investor-addmore-table" style={{ minWidth: Math.max(720, columns.length * 135) }}>
                        <thead>
                            <tr>
                                {columns.map((col: any) => (
                                    <th key={`h-${group.id}-${col.id}`} className="border-0 fw-semibold" style={{ background: '#f8fafc', color: '#334155', fontSize: '12px', padding: '10px 12px', minWidth: 120 }}>
                                        {col.label}
                                        {col.is_required === 'Y' && !readOnly ? <span className="text-danger ms-1">*</span> : null}
                                    </th>
                                ))}
                                <th className="border-0 fw-semibold text-center" style={{ background: '#f8fafc', color: '#334155', fontSize: '12px', padding: '10px 12px', width: 70 }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.length + 1} className="text-center text-muted" style={{ padding: '16px 12px' }}>
                                        No rows added.
                                    </td>
                                </tr>
                            ) : rows.map((row: any, rIdx: number) => (
                                <tr key={`r-${group.id}-${rIdx}`}>
                                    {columns.map((col: any) => (
                                        <td key={`c-${group.id}-${rIdx}-${col.id}`} data-label={String(col.label || '')} style={{ padding: 8, verticalAlign: 'top' }}>
                                            {renderAddMoreColumnInput(group.id, rIdx, col, row, columns)}
                                        </td>
                                    ))}
                                    <td className="text-center" data-label="Action" style={{ padding: 8, verticalAlign: 'middle' }}>
                                        {!readOnly && (
                                            <Button
                                                type="button"
                                                icon="pi pi-trash"
                                                text
                                                severity="danger"
                                                onClick={() => removeRow(group.id, rIdx, minRows)}
                                                disabled={rows.length <= finalMin}
                                                style={{ color: rows.length <= finalMin ? '#fecaca' : '#ef4444' }}
                                            />
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {!readOnly && (
                    <div className="d-flex align-items-center gap-3 flex-wrap mt-3">
                        <button
                            type="button"
                            onClick={() => addRow(group.id, group.max_rows, columns)}
                            disabled={typeof finalMax === 'number' ? rows.length >= finalMax : false}
                            className="border bg-white rounded-2 px-4 py-2 fw-medium"
                            style={{
                                borderColor: '#efcaca',
                                color: '#ef4444',
                                minWidth: 180,
                                opacity: typeof finalMax === 'number' && rows.length >= finalMax ? 0.6 : 1,
                            }}
                        >
                            <i className="pi pi-plus me-2" />
                            Add {displayLabel}
                        </button>
                        <small className="text-muted">({rows.length}/{finalMax ?? '∞'} rows)</small>
                    </div>
                )}
                {addMoreGroupErrors[group.id] ? (
                    <small className="text-danger d-block mt-2">{addMoreGroupErrors[group.id]}</small>
                ) : null}
            </div>
        );
    };

    const renderField = (field: any) => {
        if ((field?.id && hiddenAddMoreChildFieldIds.ids.has(Number(field.id))) || (field?.field_code && hiddenAddMoreChildFieldIds.codes.has(String(field.field_code)))) {
            return null;
        }
        const visible = computedOverrides[field.field_code]?.visible ?? true;
        const pluginFieldMeta = plugin?.getFieldMeta?.(field.field_code, values) ?? {};
        const fieldHelpText = String(pluginFieldMeta.helperText ?? field.help_text ?? '').trim() || undefined;
        const fieldHelpTextStyle = pluginFieldMeta.helperTextStyle;
        if (!visible) return null;
        if (field.input_type === 'addmore') {
            const groups = field.add_more_groups ?? [];
            // ✅ FIX: The mapping is safely outputting renderAddMoreGroup which now has a built-in key
            return (
                <div className="d-flex flex-column gap-3">
                    {groups.length === 0 ? null : groups.map((g: any) => renderAddMoreGroupCompact(g, field.label))}
                </div>
            );
        }

        // Repeatable page rendering
        if (field.input_type === 'repeatable_page' && field.repeatable_page_config) {
            return renderRepeatablePageSection(field);
        }

        // Button fields render without a label wrapper
        if (field.input_type === 'button') {
            return <div className="d-flex align-items-end h-100">{renderInput(field)}</div>;
        }

        const required = (computedOverrides[field.field_code]?.required ?? field.is_required === 'Y');
        const inlineDocs = docsForField(String(field.field_code || ''));

        // Skip label for "Same as Above" checkbox - label is rendered with checkbox
        const skipLabel = field.field_code === 'UK-FCL-03316_0' || field.field_code === 'UK-FCL-03120_0';

        return (
            <div className="d-flex flex-column h-100">
                {!skipLabel && (
                    <div className="mb-2">
                        <label className="form-label fw-semibold text-secondary d-flex align-items-center m-0" style={{ fontSize: '0.95rem' }}>
                            <span className="me-1">{field.label}</span>
                            {required && !readOnly && <span className="text-danger me-2">*</span>}
                            {fieldHelpText && (
                                <>
                                    <i className="pi pi-question-circle text-primary cursor-pointer ms-1" id={`tooltip_${field.id}`} data-pr-tooltip={fieldHelpText} data-pr-position="top" style={{ fontSize: '1.1rem' }} />
                                    <Tooltip target={`#tooltip_${field.id}`} />
                                </>
                            )}
                        </label>
                    </div>
                )}
                <div className="field-input-with-upload d-flex align-items-stretch flex-grow-1 input-wrap-mica">
                    <div className="field-input-holder w-100">
                        {renderInput(field)}
                    </div>
                    {inlineDocs.length > 0 && (
                        <div className="d-flex align-items-stretch gap-0 upload-affix-group">
                            {inlineDocs.map((doc: any) => {
                                const isUploading = uploadingDocId === Number(doc.id);
                                const isDisabled = isUploading || isSubmitting;
                                const inputId = `inline-upload-${field.id}-${doc.id}`;
                                const allowedExts = normalizeAllowedFormats(doc?.allowedFormats);
                                const acceptAttr = allowedExts.join(',');
                                return (
                                    <div key={`inline-doc-icon-${field.id}-${doc.id}`}>
                                        {!readOnly && (
                                            <>
                                                <input
                                                    id={inputId}
                                                    type="file"
                                                    className="d-none"
                                                    accept={acceptAttr || undefined}
                                                    onChange={(e) => handleInlineDocumentUpload(Number(doc.id), e.target.files?.[0] || null)}
                                                    disabled={isDisabled}
                                                />
                                                <label
                                                    htmlFor={inputId}
                                                    className="d-inline-flex align-items-center justify-content-center border upload-affix-btn"
                                                    style={{
                                                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                                                        borderColor: '#d9dee7',
                                                        background: isDisabled ? '#f3f4f6' : '#fff5f5',
                                                        color: isDisabled ? '#9ca3af' : '#dc2626',
                                                        opacity: isDisabled ? 0.8 : 1,
                                                        marginBottom: 0,
                                                    }}
                                                    title={isUploading ? 'Uploading...' : 'Upload document'}
                                                >
                                                    <i className={isUploading ? 'pi pi-spin pi-spinner' : 'pi pi-upload'} style={{ fontSize: '0.85rem' }} />
                                                </label>
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
                {inlineDocs.length > 0 && (
                    <div className="mt-2 d-flex flex-column gap-1">
                        {inlineDocs.map((doc: any) => {
                            const allowedExts = normalizeAllowedFormats(doc?.allowedFormats);
                            const uploaded = uploadedDocByChecklistId[Number(doc.id)];
                            return (
                                <div key={`inline-doc-meta-${field.id}-${doc.id}`} className="d-flex flex-column align-items-start gap-1">
                                    <div className="d-flex align-items-center gap-2 flex-wrap">
                                        <small className={uploaded?.filePath ? 'text-success' : 'text-muted'} style={{ fontSize: '0.72rem' }}>
                                            {doc?.name || `Document ${doc?.id}`}: {uploaded?.filePath ? 'Uploaded' : 'Not uploaded'}
                                        </small>
                                        {allowedExts.length > 0 && (
                                            <small className="text-muted" style={{ fontSize: '0.7rem' }}>
                                                Allowed: {allowedExts.join(', ')}
                                            </small>
                                        )}
                                        {!!uploadErrorByChecklistId[Number(doc.id)] && (
                                            <small className="text-danger" style={{ fontSize: '0.72rem' }}>
                                                {uploadErrorByChecklistId[Number(doc.id)]}
                                            </small>
                                        )}
                                    </div>
                                    {uploaded?.filePath && (
                                        <a
                                            href={resolveFileUrl(uploaded.filePath)}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-primary text-decoration-underline d-inline-flex align-items-center gap-1"
                                            style={{ fontSize: '0.78rem', fontWeight: 600 }}
                                        >
                                            <i className="pi pi-external-link" style={{ fontSize: '0.72rem' }} />
                                            View uploaded file
                                        </a>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
                {fieldHelpText && (
                    <small
                        className={fieldHelpTextStyle ? 'd-block mt-2' : /should be above|should be greater|must be above/i.test(String(fieldHelpText)) ? 'text-danger d-block mt-2' : 'text-muted d-block mt-2'}
                        style={{ fontSize: '0.82rem', ...(fieldHelpTextStyle || {}) }}
                    >
                        {fieldHelpText}
                    </small>
                )}
                {errors[field.field_code] && (touched.has(field.field_code) || touched.has('ALL_PAGE')) && (
                    <small className="text-danger d-block mt-2 fw-medium"><i className="pi pi-exclamation-circle me-1"></i>{errors[field.field_code]}</small>
                )}
            </div>
        );
    };

    const completionPercent = pages.length ? Math.round((activePageIndex / pages.length) * 100) : 0;

    return (
        <div className="p-fluid investor-runtime-form">
            <style jsx global>{`
                
            `}</style>
            <div className="row g-4">
                <div className="col-12">
                    <div className="rounded-xl p-4 border shadow-sm bg-white">
                        <div className="mb-3 d-flex justify-content-end d-none">
                            <div className="d-flex flex-column align-items-end gap-2 w-100">
                                <span className="text-xs fw-semibold text-secondary">
                                    {completionPercent}% Completed
                                </span>
                                <div className="w-100 rounded-pill overflow-hidden" style={{ height: 8, background: '#e5e7eb' }}>
                                    <div
                                        style={{
                                            width: `${completionPercent}%`,
                                            height: '100%',
                                            background: '#2E7D32',
                                            transition: 'width 0.2s ease',
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="mb-2 d-none">
                            <div className="fw-semibold text-dark">Application Pages</div>
                            <small className="text-muted">Select a page to navigate the form</small>
                        </div>
                        {pages.length === 0 ? (
                            <div className="p-3 text-muted bg-white rounded-3 border">No pages configured.</div>
                        ) : (
                            <div className="d-flex justify-content-start align-items-top process-wrap">
                                {pages.map((p: any, idx: number) => {
                                    const isCurrent = idx === activePageIndex;
                                    const isCompleted = completedPages.has(idx);
                                    const isAccessible = canNavigateToPage(idx);
                                    // Colors
                                    const circleBg = isCompleted ? '#2E7D32' : isCurrent ? '#FFFFFF' : '#FFFFFF';
                                    const circleColor = isCompleted ? '#fff' : isCurrent ? '#2E7D32' : '#BBC3C8';
                                    const circleBorder = isCompleted ? '#2E7D32' : isCurrent ? '#2E7D32' : '#BBC3C8';
                                    const labelColor = isCompleted ? '#2E7D32' : isCurrent ? '#374151' : '#BBC3C8';
                                    const textColor = isAccessible ? (isCurrent ? '#2E7D32' : '#BBC3C8') : '#BBC3C8';
                                    const titleCursor = isAccessible ? 'pointer' : 'not-allowed';
                                    return (
                                        <React.Fragment key={`page-nav-wrap:${p.id ?? idx}`}>
                                            <div className="flex-shrink-0">
                                                <div className="d-flex align-items-center justify-content-center">
                                                    <button
                                                        key={`page-nav:${p.id ?? idx}`}
                                                        type="button"
                                                        onClick={() => handlePageNavigation(idx)}
                                                        className="rounded-pill fw-semibold text-sm shrink-0"
                                                        style={{
                                                            width: 36,
                                                            height: 36,
                                                            background: circleBg,
                                                            color: circleColor,
                                                            cursor: isAccessible ? 'pointer' : 'not-allowed',
                                                            borderColor: circleBorder,
                                                            borderWidth: 2,
                                                            borderStyle: 'solid',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            transition: 'all 0.2s ease',
                                                        }}
                                                    >
                                                        {isCompleted
                                                            ? <i className="pi pi-check" style={{ fontSize: '14px' }} />
                                                            : idx + 1}
                                                    </button>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handlePageNavigation(idx)}
                                                    className="text-center border-0 bg-transparent p-0"
                                                    style={{ cursor: titleCursor }}
                                                >
                                                    <div
                                                        className="mt-2"
                                                    >
                                                        <div style={{
                                                            fontWeight: 400,
                                                            color: textColor, lineHeight: 1.25
                                                        }}>
                                                            {p.name || `Page ${idx + 1}`}
                                                        </div>
                                                        <small className="d-none" style={{ color: labelColor, transition: 'color 0.2s ease' }}>Step {idx + 1}</small>
                                                    </div>
                                                </button>
                                            </div>
                                            {idx < pages.length - 1 && (
                                                <div className="flex-shrink-0"
                                                />
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                <div className="col-12">
                    <div className="border rounded-xl bg-white overflow-hidden" style={{ borderColor: '#e5e7eb' }}>
                        <div className="px-4 pt-3 pb-0 d-flex justify-content-between align-items-start flex-wrap gap-2">
                            <div>
                                <h3 className="m-0 fw-semibold text-primary" style={{ fontSize: '1.25rem' }}>
                                    {activePage?.name || 'Application Form'}
                                </h3>
                                <p className="m-0 mt-1 text-muted d-none" style={{ fontSize: '0.92rem' }}>
                                    Step {pages.length ? activePageIndex + 1 : 0} of {pages.length}
                                </p>
                            </div>
                            <span
                                className="rounded-pill px-3 py-2 fw-semibold d-none"
                                style={{
                                    background: '#fee2e2',
                                    color: '#b91c1c',
                                    fontSize: '0.82rem',
                                }}
                            >
                                Step {pages.length ? activePageIndex + 1 : 0} of {pages.length}
                            </span>
                        </div>

                        <div className="p-4 pt-2 d-flex flex-column gap-4">
                            {activePage?.categories?.map((cat: any) => (
                                <div key={cat.id} className="rounded-lg" style={{ borderColor: '#e5e7eb' }}>
                                    <div className="">
                                        <h4 className="fw-semibold pb-3 mb-4" style={{ borderColor: '#e5e7eb', fontSize: '1rem', color: '#5E6B6D', fontWeight: '500' }}>{cat.name}</h4>
                                        <div className="row g-4">
                                            {cat.fields.map((field: any) => {
                                                const isHiddenRepeatableField = hiddenRepeatableFieldCodes.has(field.field_code);
                                                if (field.input_type !== 'repeatable_page' && isHiddenRepeatableField) {
                                                    return null;
                                                }
                                                return (
                                                    <div key={field.id} className={field.input_type === 'addmore' ? 'col-12 mt-2' : `col-12 ${BOOTSTRAP_SPANS[field.grid_span || 12]}`}>
                                                        {renderField(field)}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className="d-flex justify-content-end align-items-center mt-4 pt-4" style={{ borderColor: '#e5e7eb' }}>
                <div className="me-3">
                    {activePageIndex > 0 ? (
                        <button
                            type="button"
                            onClick={() => handlePageNavigation(activePageIndex - 1)}
                            disabled={isSubmitting}
                            className="px-4 py-2 border-1 rounded fw-medium text-sm"
                            style={{ background: '#f3f4f6', color: '#374151', opacity: isSubmitting ? 0.6 : 1 }}
                        >
                            Previous
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={isSubmitting}
                            className="px-4 py-2 border-1 rounded fw-medium text-sm"
                            style={{ background: '#FFFFFF', color: '#374151', opacity: isSubmitting ? 0.6 : 1 }}
                        >
                            Cancel
                        </button>
                    )}
                </div>

                <div className="d-flex gap-2">
                    {isLastPage && enablePreview && (
                        <button
                            type="button"
                            onClick={() => setShowPreview(true)}
                            disabled={isSubmitting}
                            className="px-4 py-2 border-1 rounded fw-medium text-sm d-flex align-items-center gap-2"
                            style={{ background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ede9fe', opacity: isSubmitting ? 0.6 : 1 }}
                        >
                            <i className="pi pi-eye" />
                            <span>Preview Application</span>
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onNext}
                        disabled={isSubmitting}
                        className={`px-4 py-2 border-0 rounded fw-medium text-sm text-white d-flex align-items-center gap-2 ${isLastPage && !readOnly ? 'bg-success' : 'bg-primary'}`}
                        style={{
                            opacity: isSubmitting ? 0.7 : 1,
                        }}
                    >
                        {isSubmitting ? (
                            <>
                                <i className="pi pi-spin pi-spinner" />
                                Processing...
                            </>
                        ) : (
                            <>
                                <span>{isLastPage ? (readOnly ? 'Close View' : (finalActionLabel || 'Submit Application')) : 'Next'}</span>
                                {!isLastPage && <i className="pi pi-arrow-right" />}
                            </>
                        )}
                    </button>
                </div>
            </div>

            <style jsx global>{`
                .p-checkbox .p-checkbox-box,
                .p-radiobutton .p-radiobutton-box {
                    background: #ffffff;
                    border: 1.5px solid #dc2626;
                    box-shadow: none;
                }

                .p-checkbox:not(.p-checkbox-checked) .p-checkbox-box,
                .p-radiobutton:not(.p-radiobutton-checked) .p-radiobutton-box {
                    background: #ffffff;
                    border-color: #dc2626;
                }

                .p-checkbox .p-checkbox-box:hover,
                .p-radiobutton .p-radiobutton-box:hover {
                    border-color: #b91c1c;
                }

                .p-checkbox.p-highlight .p-checkbox-box,
                .p-checkbox-checked .p-checkbox-box,
                .p-radiobutton.p-highlight .p-radiobutton-box,
                .p-radiobutton-checked .p-radiobutton-box {
                    background: #2563eb;
                    border-color: #2563eb;
                }

                .p-checkbox .p-checkbox-box .p-checkbox-icon {
                    color: #ffffff;
                    font-size: 0.72rem;
                }

                .p-radiobutton .p-radiobutton-box .p-radiobutton-icon {
                    background: #ffffff;
                    width: 0.5rem;
                    height: 0.5rem;
                }

                .p-checkbox.p-focus .p-checkbox-box,
                .p-radiobutton.p-focus .p-radiobutton-box {
                    box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.16);
                }
            `}</style>

            {showPreview && (
                <FormPreview
                    config={config}
                    values={values}
                    addMoreValues={addMoreValues}
                    onClose={() => setShowPreview(false)}
                />
            )}

            {/* Modal for CSV Import - Always rendered for proper visibility */}
            {importType && (
                <ImportDoctorNurseModal
                    visible={showImportModal}
                    importType={importType}
                    onClose={() => {
                        setShowImportModal(false);
                        setImportType(null);
                        setImportingRepeatablePageConfigId(null);
                    }}
                    onImport={(csvData) => {
                        // Find the config for this repeatable page
                        const allFields = (config?.pages || []).flatMap((p: any) =>
                            (p.categories || []).flatMap((c: any) => c.fields || [])
                        );
                        const field = allFields.find(
                            (f: any) => f.repeatable_page_config?.id === importingRepeatablePageConfigId
                        );
                        if (field?.repeatable_page_config) {
                            handleImportCSV(csvData, field.repeatable_page_config);
                        }
                    }}
                    isSubmitting={isSubmitting}
                />
            )}
        </div>
    );
}

