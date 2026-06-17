'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { imgPath } from '@/lib/imgPath';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Skeleton } from 'primereact/skeleton';
import { Toast } from 'primereact/toast';
import { FormRenderer } from '@/components/investor/FormRenderer';
import { useAuth } from '@/hooks/useAuth';
import apiClient from '@/lib/api-client';

type InitialFormData = {
    fields: Record<string, any>;
    addMore: Record<number, any[]>;
    repeatablePages?: Record<number, any[]>;
};

type ApprovedProjectOption = {
    submissionId: number;
    unitName: string;
    serviceId: string;
    registrationNumber: string;
    projectName: string;
    promoterName: string;
    agentName: string;
    agentType: string;
    currentStatus: string;
    approvedCompletionDate: string;
    registrationValidityEndDate: string;
    label: string;
};

type PopupSection = {
    type?: 'paragraph' | 'bullets' | 'documents' | 'table';
    content?: string;
    items?: string[];
    headers?: string[];
    rows?: string[][];
    muted?: boolean;
    heading?: 'p' | 'small' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    bold?: boolean;
    italic?: boolean;
    spacing?: string;
};

type PopupConfig = {
    title?: string;
    message?: string;
    html?: string | null;
    sections?: PopupSection[];
    acknowledgementText?: string | null;
    requiresAcknowledgement?: boolean;
};

const PROJECT_SELECTION_SERVICE_IDS = ['12267', '12265', '12266', '12263'];
const AGENT_SELECTION_SERVICE_IDS = ['12255', '12254', '12253'];
const AGENT_REGISTRATION_SERVICE_PREFIX = '12222';
const AGENT_REGISTRATION_ASSOCIATED_PROJECTS_FIELD = 'UK-FCL-03632_0';
const AGENT_REGISTRATION_PAN_DOCUMENT_FIELD = 'UK-FCL-03633_0';
const PROJECT_IDENTIFICATION_FIELDS = {
    registrationNumber: 'UK-FCL-00280_0',
    projectName: 'UK-FCL-03893_0',
    transferProjectName: 'UK-FCL-02017_0',
    promoterName: 'UK-FCL-03886_0',
    transferPromoterName: 'UK-FCL-03866_0',
    currentStatus: 'UK-FCL-03867_0',
    approvedCompletionDate: 'UK-FCL-03895_0',
} as const;
const AGENT_IDENTIFICATION_FIELDS = {
    registrationNumber: 'UK-FCL-03727_0',
    agentName: 'UK-FCL-03728_0',
    agentType: 'UK-FCL-03729_0',
    currentStatus: 'UK-FCL-03730_0',
    registrationValidityEndDate: 'UK-FCL-03731_0',
} as const;

const hasPopupContent = (value: unknown) => {
    if (typeof value === 'string') {
        return value.trim().length > 0;
    }
    if (Array.isArray(value)) {
        return value.length > 0;
    }
    return Boolean(value);
};

const looksLikeHtml = (value: string) => /<\/?[a-z][\s\S]*>/i.test(value) || value.includes('className=');

const normalizePopupHtml = (value: string) => {
    let normalized = value
        .replace(/\bclassName=/g, 'class=')
        .replace(/\bhtmlFor=/g, 'for=');

    if (!/<style[\s>]/i.test(normalized)) {
        const cssStart = normalized.search(/(?:^|\n)\s*[.#][\w-][^{\n]*\{[\s\S]*$/m);
        if (cssStart > -1) {
            const htmlPart = normalized.slice(0, cssStart).trim();
            const cssPart = normalized.slice(cssStart).trim();
            if (looksLikeHtml(htmlPart) && cssPart.includes('{')) {
                normalized = `${htmlPart}\n<style>${cssPart}</style>`;
            }
        }
    }

    return normalized;
};

const normalizePopupConfig = (raw: unknown): PopupConfig | null => {
    if (!raw) return null;

    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return null;
        try {
            const parsed = JSON.parse(trimmed);
            return normalizePopupConfig(parsed);
        } catch {
            if (looksLikeHtml(trimmed)) {
                return {
                    title: '',
                    html: normalizePopupHtml(trimmed),
                    sections: [],
                    acknowledgementText: null,
                    requiresAcknowledgement: false,
                };
            }
            return {
                title: '',
                message: trimmed,
                sections: [],
                acknowledgementText: null,
                requiresAcknowledgement: false,
            };
        }
    }

    if (typeof raw !== 'object') return null;

    const popup = raw as {
        enabled?: boolean;
        title?: string;
        sections?: PopupSection[];
        acknowledgement_text?: string;
        acknowledgementText?: string;
        message?: string;
        content?: string;
    };

    if (popup.enabled === false) return null;

    const sections = Array.isArray(popup.sections) ? popup.sections : [];
    const message = typeof popup.message === 'string'
        ? popup.message.trim()
        : typeof popup.content === 'string'
            ? popup.content.trim()
            : '';
    const html = typeof popup.content === 'string' && looksLikeHtml(popup.content)
        ? normalizePopupHtml(popup.content.trim())
        : null;

    if (!sections.length && !message && !html) return null;

    return {
        title: popup.title?.trim() || '',
        message: html ? undefined : (message || undefined),
        html,
        sections,
        acknowledgementText: popup.acknowledgement_text ?? popup.acknowledgementText ?? null,
        requiresAcknowledgement: sections.length > 0,
    };
};

const renderPopupParagraph = (section: PopupSection, index: number) => {
    const textClassName = section.muted ? 'text-muted' : '';
    const content = section.content || '';
    const textColor = section.bold || ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(section.heading || '')
        ? 'rgb(122, 30, 28)'
        : undefined;
    const style = {
        fontWeight: section.bold ? 600 : 400,
        fontStyle: section.italic ? 'italic' : 'normal',
        color: textColor,
    } as const;

    switch (section.heading) {
        case 'small':
            return <small key={index} className={textClassName} style={style}>{content}</small>;
        case 'h1':
            return <h1 key={index} className={textClassName} style={style}>{content}</h1>;
        case 'h2':
            return <h2 key={index} className={textClassName} style={style}>{content}</h2>;
        case 'h3':
            return <h3 key={index} className={textClassName} style={style}>{content}</h3>;
        case 'h4':
            return <h4 key={index} className={textClassName} style={style}>{content}</h4>;
        case 'h5':
            return <h5 key={index} className={textClassName} style={style}>{content}</h5>;
        case 'h6':
            return <h6 key={index} className={textClassName} style={style}>{content}</h6>;
        default:
            return <p key={index} className={`${textClassName} mb-0`} style={style}>{content}</p>;
    }
};

export default function ApplicationFormPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const toast = useRef<Toast>(null);
    const { user } = useAuth();

    const serviceId = params?.serviceId as string;
    const formTypeId = params?.formTypeId as string;
    const isMarriageService = String(serviceId) === '968.0' || String(serviceId) === '968';
    const locale = String(params?.locale || 'en');
    const cafId = searchParams?.get('cafId');
    const requestedPageId = Number(searchParams?.get('pageId') || 0) || null;
    const requestedSubmissionId = Number(searchParams?.get('submissionId') || 0) || null;

    const [config, setConfig] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submissionId, setSubmissionId] = useState<number | null>(null);
    const [initialData, setInitialData] = useState<InitialFormData>({ fields: {}, addMore: {} });
    const [initialPageIndex, setInitialPageIndex] = useState(0);
    const [draftLoaded, setDraftLoaded] = useState(false);
    const [approvedProjects, setApprovedProjects] = useState<ApprovedProjectOption[]>([]);
    const [selectedProject, setSelectedProject] = useState<ApprovedProjectOption | null>(null);
    const [projectLoading, setProjectLoading] = useState(false);
    const [showPopup, setShowPopup] = useState(false);
    const [popupDismissed, setPopupDismissed] = useState(false);
    const [popupAcknowledged, setPopupAcknowledged] = useState(false);
    const [popupStage, setPopupStage] = useState<1 | 2>(1);
    const isProjectFlow = PROJECT_SELECTION_SERVICE_IDS.some((prefix) => String(serviceId).startsWith(prefix));
    const isAgentRenewalFlow = AGENT_SELECTION_SERVICE_IDS.some((prefix) => String(serviceId).startsWith(prefix));
    const isAgentRegistrationFlow = String(serviceId || '').startsWith(AGENT_REGISTRATION_SERVICE_PREFIX);

    const MARRIAGE_SERVICE_IDS = new Set(['968.0', '968']);
    const WITNESS_AGE_FIELD_CODES = new Set(['UK-FCL-04295_0', 'UK-FCL-04296_0', 'UK-FCL-04297_0']);
    const getMarriageFieldHelpText = (field: any, ancestorLabels: string[] = []) => {
        const labels = [
            field?.label,
            field?.name,
            field?.field_code,
            field?.fieldCode,
            ...ancestorLabels,
        ].filter(Boolean).map((item) => String(item).trim());

        const normalized = labels.join(' ').trim().toLowerCase();
        if (!normalized) return undefined;

        if (
            WITNESS_AGE_FIELD_CODES.has(String(field?.field_code || '').trim()) ||
            WITNESS_AGE_FIELD_CODES.has(String(field?.fieldCode || '').trim())
        ) {
            return 'Witness age should be above 21 at the time of marriage.';
        }

        const roleMatcher = /\b(bride|groom|witness|priest)\b/;
        const hasMarriageRole = roleMatcher.test(normalized);
        const hasMarriageContext = normalized.includes('marriage') || normalized.includes('marital');
        const hasAgeToken = /\bage\b/.test(normalized);
        const hasPhotoToken = normalized.includes('passport') && (normalized.includes('photograph') || normalized.includes('photo'));
        const hasDobToken = normalized.includes('age at date of marriage') || normalized.includes('date of birth') || normalized.includes('dob');

        const isBrideOrGroomPassportUpload = hasPhotoToken && (hasMarriageRole || hasMarriageContext) && (normalized.includes('groom') || normalized.includes('bride'));
        const isMarriageAgeField = hasAgeToken && (hasMarriageRole || hasMarriageContext);
        const isMarriageDateField = hasDobToken && (hasMarriageRole || hasMarriageContext);

        if (isBrideOrGroomPassportUpload) {
            return 'Upload the required passport-size photograph here. It will be attached to the Marriage Registration application.';
        }

        if (isMarriageAgeField || isMarriageDateField) {
            if (normalized.includes('bride')) {
                return 'Bride age should be above 18 at the time of marriage.';
            }
            if (normalized.includes('groom')) {
                return 'Groom age should be above 21 at the time of marriage.';
            }
            if (normalized.includes('witness')) {
                return 'Witness age should be above 21 at the time of marriage.';
            }
            if (normalized.includes('priest')) {
                return 'Priest age should be above 21 at the time of marriage.';
            }
            return 'Applicant age should be above 18 at the time of marriage.';
        }

        return undefined;
    };
    const marriageFallbackPopupConfig = useMemo<PopupConfig | null>(() => {
        if (!serviceId || !MARRIAGE_SERVICE_IDS.has(serviceId)) return null;

        return {
            title: 'Marriage Registration Information',
            sections: [
                {
                    type: 'paragraph',
                    heading: 'h3',
                    content: 'Document Checklist',
                    bold: true,
                    spacing: 'mb-4',
                },
                {
                    type: 'paragraph',
                    content: '1. Memorandum of Marriage',
                    bold: true,
                },
                {
                    type: 'bullets',
                    items: ['Form D details are correctly entered'],
                    spacing: 'mb-3',
                },
                {
                    type: 'paragraph',
                    content: '2. Proof of Age (Attested photocopy of any one)',
                    bold: true,
                },
                {
                    type: 'bullets',
                    items: [
                        'School / College Leaving Certificate',
                        'Birth Certificate',
                        'Passport',
                        'Domicile Certificate',
                        'SSC / HSC Certificate',
                    ],
                    spacing: 'mb-3',
                },
                {
                    type: 'paragraph',
                    content: '3. Proof of Residence (Attested photocopy of any one)',
                    bold: true,
                },
                {
                    type: 'bullets',
                    items: [
                        'Ration Card',
                        'Election Card',
                        'Electricity Bill (in the name of person)',
                        'Telephone Bill (in the name of person)',
                        'Passport',
                        'Aadhaar Card',
                        'Others',
                    ],
                    spacing: 'mb-3',
                },
                {
                    type: 'paragraph',
                    content: '4. Registered Address Proof of Witnesses',
                    bold: true,
                },
                {
                    type: 'bullets',
                    items: [
                        'Ration Card',
                        'Election Card',
                        'Electricity Bill',
                        'Telephone Bill',
                        'Passport',
                        'Aadhaar Card',
                        'Others',
                    ],
                    spacing: 'mb-3',
                },
                {
                    type: 'paragraph',
                    content: '5. Wedding Card Proof',
                    bold: true,
                },
                {
                    type: 'bullets',
                    items: [
                        'Marriage Invitation Card',
                        '₹100/- General Stamp Paper (if invitation card is not available)',
                    ],
                    spacing: 'mb-3',
                },
                {
                    type: 'paragraph',
                    content: '6. Photographs & Declarations',
                    bold: true,
                },
                {
                    type: 'bullets',
                    items: [
                        'Passport-size photographs of Bride & Groom',
                        'Passport-size photographs of Witness 1 / 2 / 3',
                        'Self Declaration Letter of Bride & Groom (Attested copy)',
                        'Colored Photo of Marriage Ceremony',
                    ],
                    spacing: 'mb-2',
                },
                {
                    type: 'paragraph',
                    content: 'Note: Passport-size photographs uploaded here will be attached to the Marriage Registration application.',
                    muted: true,
                },
                {
                    type: 'paragraph',
                    heading: 'h3',
                    content: 'Process Flow',
                    bold: true,
                    spacing: 'mb-4',
                },
                {
                    type: 'bullets',
                    items: [
                        '1. Fill Application Form - Fill the Marriage Application Form and complete document checklist',
                        '2. Submit & Get Registration Number - Registration number generated after submission',
                        '3. Make Online Payment - Pay scrutiny fees and get appointment date & time',
                        '4. Visit Office for Verification - Visit registrar office with original documents',
                        '5. Approval & Certificate Issued - Certificate issued after approval',
                        '6. Physical visit with original documents is compulsory to complete the marriage registration process',
                    ],
                    spacing: 'mb-0',
                },
            ],
            acknowledgementText: 'I have read and understood the marriage registration information.',
            requiresAcknowledgement: true,
        };
    }, [serviceId]);

    const popupConfig = useMemo(
        () => normalizePopupConfig(config?.popupData) || marriageFallbackPopupConfig,
        [config?.popupData, marriageFallbackPopupConfig]
    );

    const applyMarriageFieldLevelHelpText = (field: any, ancestorLabels: string[] = []) => {
        if (!MARRIAGE_SERVICE_IDS.has(serviceId)) return field;
        const existingHelpText = field?.help_text || field?.helpText;
        const additionalHelpText = getMarriageFieldHelpText(field, ancestorLabels);
        const helpTextValue = existingHelpText || additionalHelpText;

        const transformedField = {
            ...field,
            help_text: helpTextValue,
            helpText: field?.helpText ?? helpTextValue,
        };

        if (Array.isArray(field?.add_more_groups)) {
            const currentAncestorLabels = [
                ...ancestorLabels,
                field?.label,
                field?.name,
                field?.field_code,
                field?.fieldCode,
            ].filter(Boolean).map((item) => String(item).trim());

            transformedField.add_more_groups = field.add_more_groups.map((group: any) => {
                const groupAncestorLabels = [
                    ...currentAncestorLabels,
                    group?.label,
                    group?.name,
                ].filter(Boolean).map((item) => String(item).trim());

                return {
                    ...group,
                    columns: Array.isArray(group.columns)
                        ? group.columns.map((col: any) => applyMarriageFieldLevelHelpText(col, groupAncestorLabels))
                        : group.columns,
                    fields: Array.isArray(group.fields)
                        ? group.fields.map((nestedField: any) => applyMarriageFieldLevelHelpText(nestedField, groupAncestorLabels))
                        : group.fields,
                };
            });
        }

        return transformedField;
    };

    const applyMarriageHelpTextToConfig = (configToTransform: any) => ({
        ...configToTransform,
        pages: Array.isArray(configToTransform.pages)
            ? configToTransform.pages.map((page: any) => ({
                ...page,
                categories: Array.isArray(page.categories)
                    ? page.categories.map((category: any) => ({
                        ...category,
                        fields: Array.isArray(category.fields)
                            ? category.fields.map((field: any) => applyMarriageFieldLevelHelpText(field))
                            : [],
                    }))
                    : [],
            }))
            : configToTransform.pages,
    });

    const effectiveConfig = useMemo(() => {
        if (!config) return config;

        if (!isAgentRegistrationFlow) return applyMarriageHelpTextToConfig(config);

        const approvedProjectOptions = approvedProjects.map((project) => {
            const label =
                project.label ||
                `${project.projectName || 'Approved Project'} - ${project.registrationNumber || project.submissionId}`;
            const value = String(project.registrationNumber || project.submissionId || '').trim();
            return { label, value };
        }).filter((option) => option.value);

        const transformedConfig = {
            ...config,
            pages: Array.isArray(config?.pages)
                ? config.pages.map((page: any) => ({
                    ...page,
                    categories: Array.isArray(page?.categories)
                        ? page.categories.map((category: any) => ({
                            ...category,
                            fields: Array.isArray(category?.fields)
                                ? category.fields.map((field: any) => {
                                    if (String(field?.field_code || '') === AGENT_REGISTRATION_PAN_DOCUMENT_FIELD) {
                                        const existingRules =
                                            typeof field?.validation_rule === 'string'
                                                ? (() => {
                                                    try { return JSON.parse(field.validation_rule); } catch { return {}; }
                                                })()
                                                : (field?.validation_rule || {});
                                        return {
                                            ...field,
                                            input_type: 'file',
                                            validation_rule: {
                                                ...existingRules,
                                                accept: '.pdf',
                                                max_size_mb: 10,
                                            },
                                        };
                                    }
                                    if (String(field?.field_code || '') === AGENT_REGISTRATION_ASSOCIATED_PROJECTS_FIELD) {
                                        const currentValue = String(initialData?.fields?.[AGENT_REGISTRATION_ASSOCIATED_PROJECTS_FIELD] ?? '').trim();
                                        const normalizedOptions = [...approvedProjectOptions];
                                        if (
                                            currentValue &&
                                            !normalizedOptions.some((option) => String(option.value) === currentValue)
                                        ) {
                                            normalizedOptions.unshift({
                                                label: `${currentValue} (Previously selected)`,
                                                value: currentValue,
                                            });
                                        }
                                        return {
                                            ...field,
                                            input_type: 'select',
                                            options: normalizedOptions,
                                            option_config: null,
                                            placeholder: 'Select approved project',
                                        };
                                    }
                                    return field;
                                })
                                : [],
                        }))
                        : [],
                }))
                : config?.pages,
        };

        return applyMarriageHelpTextToConfig(transformedConfig);
    }, [approvedProjects, config, initialData?.fields, isAgentRegistrationFlow, serviceId, MARRIAGE_SERVICE_IDS]);

    const pageTitle =
        effectiveConfig?.serviceName ||
        effectiveConfig?.service_name ||
        effectiveConfig?.service?.serviceName ||
        effectiveConfig?.service?.service_name ||
        effectiveConfig?.service?.name ||
        effectiveConfig?.service_title ||
        effectiveConfig?.formName ||
        'Application Form';
    const popupTitle = (popupConfig?.title && popupConfig.title.trim()) || `${pageTitle} Checklist`;

    const popupStages = useMemo(() => {
        if (!popupConfig) return [];
        const splitIndex = Array.isArray(popupConfig.sections)
            ? popupConfig.sections.findIndex((section: any) => {
                if (section?.type !== 'paragraph') return false;
                const headingText = typeof section?.heading === 'string' ? section.heading.toLowerCase() : '';
                const contentText = typeof section?.content === 'string' ? section.content.toLowerCase() : '';
                return headingText.includes('process flow') || contentText.includes('process flow');
            })
            : -1;

        if (splitIndex < 0 || !Array.isArray(popupConfig.sections)) {
            return [popupConfig];
        }

        const checklistSections = popupConfig.sections.slice(0, splitIndex);
        const processSections = popupConfig.sections.slice(splitIndex);

        return [
            {
                ...popupConfig,
                title: popupTitle,
                sections: checklistSections,
                requiresAcknowledgement: popupConfig.requiresAcknowledgement,
                acknowledgementText: popupConfig.acknowledgementText,
            },
            {
                ...popupConfig,
                title: `${popupTitle} - Process Flow`,
                sections: processSections,
                requiresAcknowledgement: false,
                acknowledgementText: '',
            },
        ];
    }, [popupConfig, popupTitle]);

    const currentPopupStageConfig = popupStages.length > 0 ? popupStages[popupStage - 1] : popupConfig;
    const hasPopupStages = popupStages.length > 1;

    useEffect(() => {
        if (popupConfig && !popupDismissed) {
            setShowPopup(true);
            setPopupStage(1);
            setPopupAcknowledged(false);
        }
    }, [popupConfig, popupDismissed]);

    useEffect(() => {
        if (!serviceId || !formTypeId) return;

        apiClient
            .get(`/investor/services/${serviceId}/form/${formTypeId}`, {
                params: { locale },
            })
            .then((res) => setConfig(res.data))
            .catch(() => setError(true))
            .finally(() => setLoading(false));
    }, [serviceId, formTypeId, locale]);

    useEffect(() => {
        setSubmissionId(requestedSubmissionId);
    }, [requestedSubmissionId]);

    useEffect(() => {
        if (!submissionId) {
            setInitialData({ fields: {}, addMore: {}, repeatablePages: {} });
            const pages = Array.isArray(config?.pages) ? config.pages : [];
            const pageIndexFromQuery =
                requestedPageId && pages.length
                    ? Math.max(0, pages.findIndex((page: any) => Number(page?.id) === requestedPageId))
                    : 0;
            setInitialPageIndex(pageIndexFromQuery >= 0 ? pageIndexFromQuery : 0);
            setDraftLoaded(true);
            return;
        }

        setDraftLoaded(false);
        apiClient
            .get(`/investor/services/draft/${submissionId}`)
            .then((res) => {
                const draft = res?.data || {};
                const formData = draft?.formData || {};
                setInitialData({
                    fields: formData?.fields || {},
                    addMore: formData?.addMore || {},
                    repeatablePages: formData?.repeatablePages || {},
                });
                const savedStep = Number(formData?.__currentStep || 0);
                const pages = Array.isArray(config?.pages) ? config.pages : [];
                const pageIndexFromQuery =
                    requestedPageId && pages.length
                        ? pages.findIndex((page: any) => Number(page?.id) === requestedPageId)
                        : -1;
                if (pageIndexFromQuery >= 0) {
                    setInitialPageIndex(pageIndexFromQuery);
                } else {
                    setInitialPageIndex(Number.isFinite(savedStep) && savedStep >= 0 ? savedStep : 0);
                }
            })
            .catch(() => {
                setInitialData({ fields: {}, addMore: {}, repeatablePages: {} });
                setInitialPageIndex(0);
            })
            .finally(() => setDraftLoaded(true));
    }, [submissionId, requestedPageId, config]);

    useEffect(() => {
        if (!isProjectFlow && !isAgentRenewalFlow && !isAgentRegistrationFlow) return;

        setProjectLoading(true);
        apiClient
            .get('/investor/project-status-update/caf-options', { params: { serviceId } })
            .then((res) => {
                const items = Array.isArray(res?.data) ? res.data : [];
                setApprovedProjects(items.map((item: any) => ({
                    submissionId: Number(item?.submissionId || 0),
                    unitName: String(item?.unitName || ''),
                    serviceId: String(item?.serviceId || ''),
                    registrationNumber: String(item?.registrationNumber || item?.submissionId || '').trim(),
                    projectName: String(item?.projectName || '').trim(),
                    promoterName: String(item?.promoterName || '').trim(),
                    agentName: String(item?.agentName || '').trim(),
                    agentType: String(item?.agentType || '').trim(),
                    currentStatus: String(item?.currentStatus || '').trim(),
                    approvedCompletionDate: String(item?.approvedCompletionDate || '').trim(),
                    registrationValidityEndDate: String(item?.registrationValidityEndDate || '').trim(),
                    label: String(item?.label || '').trim(),
                })).filter((item: ApprovedProjectOption) => item.submissionId > 0));
            })
            .catch(() => setApprovedProjects([]))
            .finally(() => setProjectLoading(false));
    }, [isAgentRegistrationFlow, isAgentRenewalFlow, isProjectFlow, serviceId]);

    const handleProjectSelect = (project: ApprovedProjectOption) => {
        const isProjectTransfer = String(serviceId).startsWith('12263');
        setSelectedProject(project);
        setInitialData({
            fields: {
                ...(isAgentRenewalFlow
                    ? {
                        [AGENT_IDENTIFICATION_FIELDS.registrationNumber]: project.registrationNumber || String(project.submissionId),
                        [AGENT_IDENTIFICATION_FIELDS.agentName]: project.agentName || project.label,
                        [AGENT_IDENTIFICATION_FIELDS.agentType]: project.agentType,
                        [AGENT_IDENTIFICATION_FIELDS.currentStatus]: project.currentStatus || 'Approved',
                        [AGENT_IDENTIFICATION_FIELDS.registrationValidityEndDate]: project.registrationValidityEndDate,
                    }
                    : {
                        [PROJECT_IDENTIFICATION_FIELDS.registrationNumber]: project.registrationNumber || String(project.submissionId),
                        [PROJECT_IDENTIFICATION_FIELDS.projectName]: project.projectName,
                        [PROJECT_IDENTIFICATION_FIELDS.transferProjectName]: project.projectName,
                        [PROJECT_IDENTIFICATION_FIELDS.promoterName]: project.promoterName,
                        [PROJECT_IDENTIFICATION_FIELDS.transferPromoterName]: project.promoterName,
                        [PROJECT_IDENTIFICATION_FIELDS.currentStatus]: 'Approved',
                        ...(isProjectTransfer ? {} : { [PROJECT_IDENTIFICATION_FIELDS.approvedCompletionDate]: project.approvedCompletionDate }),
                    }),
            },
            addMore: {},
        });
        setInitialPageIndex(0);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const loadingDraft = useMemo(() => !draftLoaded, [draftLoaded]);

    const saveProgress = async (values: any, addMoreValues: any, repeatablePageValues: any, currentStep: number) => {
        const formData = { fields: values, addMore: addMoreValues, repeatablePages: repeatablePageValues };
        const res = await apiClient.post('/investor/services/save-progress', {
            serviceId,
            formTypeId: Number(formTypeId),
            formData,
            cafId: selectedProject?.submissionId ? String(selectedProject.submissionId) : cafId || undefined,
            submissionId: submissionId || undefined,
            currentStep,
        });
        const nextSubmissionId = Number(res?.data?.submissionId || 0) || null;
        if (nextSubmissionId) {
            setSubmissionId(nextSubmissionId);
        }
        return res?.data;
    };

    const handleSaveNext = async ({ values, addMoreValues, repeatablePageValues, nextPageIndex }: any) => {
        setIsSubmitting(true);
        try {
            await saveProgress(values, addMoreValues, repeatablePageValues, nextPageIndex);
            return true;
        } catch (e: any) {
            toast.current?.show({
                severity: 'error',
                summary: 'Save Failed',
                detail: e?.response?.data?.message || e?.message || 'Unable to save draft.',
            });
            return false;
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleEnsureSubmissionId = async ({ values, addMoreValues, repeatablePageValues, currentPageIndex }: any) => {
        const saveResult = await saveProgress(values, addMoreValues, repeatablePageValues, currentPageIndex);
        return Number(saveResult?.submissionId || 0) || null;
    };

    const handleSubmit = async (values: any, addMoreValues: any, repeatablePageValues: any) => {
        setIsSubmitting(true);
        try {
            const finalStepIndex = Array.isArray(effectiveConfig?.pages) && effectiveConfig.pages.length > 0 ? effectiveConfig.pages.length - 1 : 0;
            const saveResult = await saveProgress(values, addMoreValues, repeatablePageValues, finalStepIndex);
            const nextSubmissionId = Number(saveResult?.submissionId || submissionId || 0);
            if (!nextSubmissionId) {
                throw new Error('Unable to resolve submission id.');
            }
            const isMarriageService = String(serviceId) === '968.0' || String(serviceId) === '968';

if (isMarriageService) {
    await apiClient.post('/investor/services/final-submit', {
        serviceId,
        formTypeId: Number(formTypeId),
        submissionId: nextSubmissionId,
    });

    router.replace(`/${locale}/investor/applications?submitted=1`);
    return;
}

if (isMarriageService) {
    await apiClient.post('/investor/services/final-submit', {
        serviceId,
        formTypeId: Number(formTypeId),
        submissionId: nextSubmissionId,
    });

    router.replace(`/${locale}/investor/applications?submitted=1`);
    return;
}

router.push(`/${locale}/investor/services/${serviceId}/apply/${formTypeId}/documents?submissionId=${nextSubmissionId}`);
        } catch (e: any) {
            toast.current?.show({
                severity: 'error',
                summary: 'Save Failed',
                detail: e?.response?.data?.message || e?.message || 'Something went wrong',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (loading || loadingDraft) {
        return (
            <div className="max-w mx-auto">
                <Skeleton height="400px" />
            </div>
        );
    }

    if (error) {
        return <div className="max-w mx-auto text-center text-red-500">Failed to load form configuration.</div>;
    }

    return (
        <div className="max-w mx-auto">
            <Toast ref={toast} />

            {showPopup && currentPopupStageConfig && (
                <div className="modal show d-block" style={{ backgroundColor: 'rgba(15, 23, 42, 0.55)', zIndex: 1055 }}>
                    <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: '660px', width: '100%' }}>
                        <div className="modal-content border-0 shadow-lg" style={{ width: '100%' }}>
                            <div className="modal-header">
                                <h5 className="modal-title fw-bold" style={{ color: 'rgb(122, 30, 28)' }}>{currentPopupStageConfig.title || popupTitle}</h5>
                            </div>
                            <div className="modal-body p-4">
                                <div
                                    className="text-sm text-gray-700 popup-scroll-content"
                                    style={{
                                        maxHeight: popupStage === 1 ? 'none' : 'calc(75vh - 100px)',
                                        overflowY: popupStage === 1 ? 'visible' : 'auto',
                                    }}
                                >
                                    {currentPopupStageConfig.sections?.map((section, index) => (
                                        <div key={`${section.type || 'section'}-${index}`} className={section.spacing || 'mb-3'}>
                                            {section.type === 'paragraph' && renderPopupParagraph(section, index)}

                                            {section.type === 'bullets' && (
                                                <ul className="mb-0" style={{ marginLeft: 0, paddingLeft: '1.1rem', listStylePosition: 'outside' }}>
                                                    {(section.items || []).filter(hasPopupContent).map((item, itemIndex) => (
                                                        <li key={`${index}-bullet-${itemIndex}`} style={{ paddingLeft: 0 }}>{item}</li>
                                                    ))}
                                                </ul>
                                            )}

                                            {section.type === 'documents' && (
                                                <div>
                                                    <div className="fw-semibold mb-2">Documents Required</div>
                                                    <ul className="ps-3 mb-0">
                                                        {(section.items || []).filter(hasPopupContent).map((item, itemIndex) => (
                                                            <li key={`${index}-doc-${itemIndex}`}>{item}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}

                                            {section.type === 'table' && Array.isArray(section.headers) && section.headers.length > 0 && (
                                                <div className="table-responsive">
                                                    <table className="table table-bordered mb-0">
                                                        <thead>
                                                            <tr>
                                                                {section.headers.map((header, headerIndex) => (
                                                                    <th key={`${index}-header-${headerIndex}`}>{header}</th>
                                                                ))}
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {(section.rows || []).map((row, rowIndex) => (
                                                                <tr key={`${index}-row-${rowIndex}`}>
                                                                    {row.map((cell, cellIndex) => (
                                                                        <td key={`${index}-cell-${rowIndex}-${cellIndex}`}>{cell}</td>
                                                                    ))}
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>
                                    ))}

                                    {currentPopupStageConfig.html && (
                                        <div dangerouslySetInnerHTML={{ __html: currentPopupStageConfig.html }} />
                                    )}

                                    {!currentPopupStageConfig.sections?.length && currentPopupStageConfig.message && (
                                        <div className="whitespace-pre-wrap">{currentPopupStageConfig.message}</div>
                                    )}
                                </div>
                                <style jsx>{`
                                    .popup-scroll-content :global(.scl-content) {
                                        height: auto !important;
                                        max-height: none !important;
                                        overflow: visible !important;
                                    }

                                    .popup-scroll-content :global([class*='overflow-y-auto']) {
                                        overflow-y: visible !important;
                                    }

                                    .popup-scroll-content :global([class*='max-h-']) {
                                        max-height: none !important;
                                    }
                                `}</style>

                                {popupStage === 1 && currentPopupStageConfig.requiresAcknowledgement && !MARRIAGE_SERVICE_IDS.has(serviceId) && (
                                    <div className="form-check mt-4">
                                        <input
                                            id="service-popup-ack"
                                            className="form-check-input"
                                            type="checkbox"
                                            checked={popupAcknowledged}
                                            onChange={(event) => setPopupAcknowledged(event.target.checked)}
                                        />
                                        <label className="form-check-label" htmlFor="service-popup-ack">
                                            {currentPopupStageConfig.acknowledgementText || 'I have read and understood the above information'}
                                        </label>
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer d-flex justify-content-between flex-row flex-nowrap">
                                {hasPopupStages && popupStage > 1 && (
                                    <button
                                        type="button"
                                        className="btn btn-outline-secondary flex-shrink-0"
                                        onClick={() => setPopupStage(1)}
                                    >
                                        Back
                                    </button>
                                )}

                                <div className='d-flex w-100 justify-content-end'>
                                    <button
                                        type="button"
                                        className="btn btn-outline-secondary me-3"
                                        onClick={() => {
                                            setShowPopup(false);
                                            setPopupDismissed(true);
                                        }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        style={{
                                            backgroundColor: 'rgb(122, 30, 28)',
                                            borderColor: 'rgb(122, 30, 28)',
                                            color: '#ffffff',
                                        }}
                                        disabled={popupStage === 1 && !MARRIAGE_SERVICE_IDS.has(serviceId) && currentPopupStageConfig.requiresAcknowledgement && !popupAcknowledged}
                                        onClick={() => {
                                            if (hasPopupStages && popupStage === 1) {
                                                setPopupStage(2);
                                                return;
                                            }

                                            setShowPopup(false);
                                            setPopupDismissed(true);
                                        }}
                                    >
                                        {hasPopupStages && popupStage === 1 ? 'Proceed' : 'Proceed'}
                                    </button>

                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {(isProjectFlow || isAgentRenewalFlow) && (
                <div className="mb-4 rounded-3 border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3">
                        <h2 className="text-lg font-semibold text-slate-900">{isAgentRenewalFlow ? 'Select an Approved Agent' : 'Select an Approved Project'}</h2>
                        <p className="text-sm text-slate-500">
                            {isAgentRenewalFlow
                                ? 'Choose one approved agent to open the Agent Identification form with Registration Number, Agent Name, Agent Type, Current Registration Status, and Registration Validity End Date prefilled.'
                                : 'Choose one approved project to open the Project Identification form with Registration Number, Project Name, and Promoter Name prefilled.'}
                        </p>
                    </div>
                    {projectLoading ? (
                        <div className="text-sm text-slate-500">{isAgentRenewalFlow ? 'Loading approved agents...' : 'Loading approved projects...'}</div>
                    ) : approvedProjects.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                            {isAgentRenewalFlow ? 'No approved agents found for this account.' : 'No approved projects found for this account.'}
                        </div>
                    ) : (
                        <select
                            value={selectedProject?.submissionId || ''}
                            onChange={(e) => {
                                const project = approvedProjects.find((p) => p.submissionId === Number(e.target.value));
                                if (project) handleProjectSelect(project);
                            }}
                            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 shadow-sm transition hover:border-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                        >
                            <option value="">-- Select {isAgentRenewalFlow ? 'an Agent' : 'a Project'} --</option>
                            {approvedProjects.map((project) => (
                                <option key={project.submissionId} value={project.submissionId}>
                                    {isAgentRenewalFlow ? project.agentName || project.label : project.projectName || project.label}
                                    {' '}
                                    (Reg: {project.registrationNumber || project.submissionId})
                                </option>
                            ))}
                        </select>
                    )}
                </div>
            )}
            {(isProjectFlow || isAgentRenewalFlow) && !selectedProject && (
                <div className="rounded-3 border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                    {isAgentRenewalFlow
                        ? 'Select an approved agent above to open the form with the identification fields prefilled.'
                        : 'Select an approved project above to open the form with the identification fields prefilled.'}
                </div>
            )}
            {(!(isProjectFlow || isAgentRenewalFlow) || selectedProject) && (
                <>
                    <div className="mb-2 d-flex justify-content-between align-items-start">
                        <div>
                            <h1 className="text-2xl font-bold text-primary">{pageTitle}</h1>
                            <p className="text-gray-500 mt-1">
                                Fill out the form below to submit your application. Fields marked with <span style={{ color: '#dc2626' }}>*</span> are mandatory.
                            </p>
                        </div>
                        {user?.tenantSlug === 'nmc' && (
                            <img src={imgPath('/img/line-art.png')} alt="Invest Uttarakhand" className="" />
                        )}
                    </div>
                    <div>
                        <FormRenderer
                            config={effectiveConfig}
                            serviceId={serviceId}
                            enablePreview={config?.enable_preview || false}
                            submissionId={submissionId || undefined}
                            initialData={initialData}
                            initialPageIndex={initialPageIndex}
                            onSaveNext={handleSaveNext}
                            onEnsureSubmissionId={handleEnsureSubmissionId}
                            onSubmit={handleSubmit}
                            onCancel={() => router.back()}
                            isSubmitting={isSubmitting}
                            finalActionLabel={isMarriageService ? 'Submit' : 'Save & Continue to Documents'}
                        />
                    </div>
                </>
            )}
        </div>
    );
}
