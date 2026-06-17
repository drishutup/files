import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { YnFlag, OptionSourceType } from '@prisma/client';
import {
  DraftApplicationDto,
  FinalSubmitDto,
  SaveProgressDto,
} from './dto/submit-application.dto';
import { CommonDocumentService } from '../../common/document/document.service';
import { WorkflowBuilderEngineService } from '../../workflow-builder/workflow-builder-engine.service';

// Configuration Constants
const CAF_SERVICE_ID = '591.0';
const APP_STATUS_APPROVED = 'A';

@Injectable()
export class InvestorServicesService {
  private readonly logger = new Logger(InvestorServicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commonDocumentService: CommonDocumentService,
    private readonly workflowEngine: WorkflowBuilderEngineService,
  ) { }

  private normalizeLocale(locale?: string): 'en' | 'hi' {
    const normalized = String(locale ?? 'en').trim().toLowerCase();
    return normalized.startsWith('hi') ? 'hi' : 'en';
  }

  private resolveServiceNameByLocale(
    locale: 'en' | 'hi',
    service: { service_name?: string | null; nameInHindi?: string | null } | null | undefined,
  ): string {
    const en = String(service?.service_name ?? '').trim();
    const hi = String(service?.nameInHindi ?? '').trim();
    if (locale === 'hi') return hi || en || 'Unknown Service';
    return en || hi || 'Unknown Service';
  }

  private pickLocalizedText(
    componentProps: any,
    key: string,
    locale: 'en' | 'hi',
    fallback?: string | null,
  ): string {
    const fallbackText = fallback == null ? '' : String(fallback);
    if (!componentProps || typeof componentProps !== 'object') return fallbackText;
    const i18n = (componentProps as any).i18n;
    if (!i18n || typeof i18n !== 'object') return fallbackText;
    const bucket = (i18n as any)[key];
    if (!bucket || typeof bucket !== 'object') return fallbackText;

    const direct = bucket[locale];
    if (typeof direct === 'string' && direct.trim() !== '') return direct;
    const english = bucket.en;
    if (typeof english === 'string' && english.trim() !== '') return english;
    return fallbackText;
  }

  private resolveFieldLabel(
    locale: 'en' | 'hi',
    customLabel: string | null | undefined,
    nameEn: string | null | undefined,
    nameHi: string | null | undefined,
    componentProps?: any,
  ): string {
    const custom = String(customLabel ?? '').trim();
    const en = String(nameEn ?? '').trim();
    const hi = String(nameHi ?? '').trim();

    // Explicit localized label from component props (if present)
    const localized = this.pickLocalizedText(componentProps, 'label', locale, '');
    if (localized.trim() !== '') return localized;

    if (locale === 'hi') {
      // If custom label is absent or just same as EN master, prefer Hindi master label.
      if (!custom || (en && custom === en)) {
        return hi || en || custom;
      }
      return custom;
    }

    return custom || en || hi;
  }

  private async ensureSpApplication(options: {
    submissionId: number;
    serviceId: string;
    formTypeId: number;
    userId: number;
    parentSubId?: number;
    unitName?: string | null;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const existing = await this.prisma.spApplication.findFirst({
      where: { appId: BigInt(options.submissionId) },
      select: { sno: true },
    });
    if (existing?.sno) {
      return existing.sno;
    }

    const service = await this.prisma.service.findFirst({
      where: { service_id: options.serviceId },
      select: { service_name: true, swcs_service_id: true, department_id: true },
    });

    const department = service?.department_id
      ? await this.prisma.department.findUnique({
        where: { id: service.department_id },
        select: { uniqueTag: true },
      })
      : null;

    const now = new Date();
    const created = await this.prisma.spApplication.create({
      data: {
        spTag: department?.uniqueTag || '',
        spAppId: service?.swcs_service_id ? String(service.swcs_service_id) : options.serviceId,
        appId: BigInt(options.submissionId),
        appName: service?.service_name || 'Service Application',
        appFields: {},
        appStatus: 'P',
        appComments: 'Application submitted',
        appDistt: '0',
        appDisttName: '',
        appLocation: '',
        isAppliedByCaf: null,
        cafId: options.parentSubId || 0,
        cafType: null,
        unitName: options.unitName || '',
        revertedCallBackUrl: `/investor/services/${options.serviceId}/apply/${options.formTypeId}?submissionId=${options.submissionId}`,
        printAppCallBackUrl: `/investor/applications/${options.submissionId}`,
        downloadCertificateCallBackUrl: '',
        userId: BigInt(options.userId),
        createdOn: now,
        updatedOn: now,
        isActive: 'Y',
        remoteServer: options.ipAddress || '',
        userAgent: options.userAgent || '',
        param1: BigInt(0),
        param2: '',
        param3: '',
        param4: '',
        param5: '',
        isOfflineApplication: 'N',
        isUploadedSignedCertificate: 'N',
        deemedApproved: '0',
      },
      select: { sno: true },
    });

    return created.sno;
  }

  private buildBuilderEditUrl(serviceId: string, formTypeId: number, submissionId: number) {
    return `/investor/services/${serviceId}/apply/${formTypeId}?submissionId=${submissionId}&mode=edit`;
  }

  private buildBuilderDocumentsUrl(serviceId: string, formTypeId: number, submissionId: number) {
    return `/investor/services/${serviceId}/apply/${formTypeId}/documents?submissionId=${submissionId}`;
  }

  private sanitizeBuilderFormData(formData: any, currentStep?: number) {
    const next =
      formData && typeof formData === 'object'
        ? JSON.parse(JSON.stringify(formData))
        : { fields: {}, addMore: {}, repeatablePages: {} };
    if (!next.fields || typeof next.fields !== 'object') next.fields = {};
    if (!next.addMore || typeof next.addMore !== 'object') next.addMore = {};
    if (!next.repeatablePages || typeof next.repeatablePages !== 'object') next.repeatablePages = {};
    if (currentStep !== undefined) {
      const step = Number(currentStep);
      next.__currentStep = Number.isFinite(step) && step >= 0 ? step : 0;
    }
    return next;
  }

  private resolveBuilderUnitName(formData: any, fallback?: string | null) {
    const fields = formData?.fields && typeof formData.fields === 'object' ? formData.fields : {};
    const preferredCodes = [
      'UK-FCL-00007_0',
      'UK-FCL-00038_1',
      'UK-FCL-00002_0',
      'UK-FCL-00120_0',
    ];
    for (const code of preferredCodes) {
      const value = String(fields?.[code] ?? '').trim();
      if (value) return value;
    }
    const firstText = Object.values(fields).find(
      (value) => typeof value === 'string' && value.trim().length > 0,
    );
    return typeof firstText === 'string' && firstText.trim() ? firstText.trim() : String(fallback ?? '').trim();
  }

  private resolveBuilderDistrictId(formData: any) {
    const fields = formData?.fields && typeof formData.fields === 'object' ? formData.fields : {};
    const candidateCodes = [
      'UK-FCL-00194_0',
      'UK-FCL-00015_0',
      'UK-FCL-00015_1',
      'UK-FCL-00015_2',
      'UK-FCL-00076_0',
    ];
    for (const code of candidateCodes) {
      const raw = fields?.[code];
      const parsed = Number(Array.isArray(raw) ? raw[0] : raw);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
  }

  private async resolveBuilderLandRegionId(serviceId: string, formData: any) {
    const fields =
      formData?.fields && typeof formData.fields === 'object' ? formData.fields : {};

    try {
      const rows = await this.prisma.$queryRawUnsafe<any[]>(`
        SELECT id, use_for, field_code, service_id
        FROM public."m_fb_config_values"
        WHERE "isActive" = 't'
          AND LOWER(COALESCE(use_for, '')) = 'landrigion_id'
          AND COALESCE(service_id, '0') IN ('0', $1)
        ORDER BY CASE WHEN COALESCE(service_id, '0') = $1 THEN 0 ELSE 1 END, id ASC
      `, String(serviceId || ''));

      for (const row of rows || []) {
        const fieldCode = String(row?.field_code || '').trim();
        if (!fieldCode) continue;
        const raw = fields?.[fieldCode];
        const parsed = Number(Array.isArray(raw) ? raw[0] : raw);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
    } catch {
      // Fallback to legacy heuristic when config table is unavailable or not populated.
    }

    return this.resolveBuilderDistrictId(formData);
  }

  private async createBuilderHistory(options: {
    sno?: number | null;
    serviceId: string;
    spTag: string;
    submissionId: number;
    status: string;
    comments: string;
    roleId?: number | null;
    nextRoleId?: number | null;
    ipAddress?: string;
    userAgent?: string;
  }) {
    await this.prisma.applicationHistory.create({
      data: {
        sno: options.sno ?? null,
        serviceId: options.serviceId,
        spTag: options.spTag || '',
        appId: String(options.submissionId),
        applicationStatus: options.status,
        comments: options.comments,
        approverId: null,
        approverDetails: null,
        nextApprover: options.nextRoleId ? String(options.nextRoleId) : null,
        addedDateTime: new Date(),
        sentDatedTime: null,
        roleId: options.roleId ? String(options.roleId) : null,
        roleName: null,
        roleUserInfo: null,
        nextRoleId: options.nextRoleId ? String(options.nextRoleId) : null,
        remoteServer: options.ipAddress || '',
        userAgent: options.userAgent || '',
      },
    });
  }

  private async validateMandatoryDocuments(
    submissionId: number,
    serviceId: string,
    userId: number,
  ) {
    const checklist = await this.commonDocumentService.getDocumentChecklist(serviceId);
    const requiredIds = checklist
      .filter((item: any) => String(item?.isRequired || '').toUpperCase() === 'Y')
      .map((item: any) => Number(item.id))
      .filter((id) => Number.isFinite(id));

    if (!requiredIds.length) return;

    const uploads = await this.commonDocumentService.getUploadedDocuments({
      submissionId,
      serviceId,
      userId: BigInt(userId),
    });
    const uploadedMap = new Map<number, any>();
    for (const item of uploads?.uploads || []) {
      uploadedMap.set(Number(item.documentMasterId), item);
    }

    const missing = checklist.filter((item: any) => {
      if (String(item?.isRequired || '').toUpperCase() !== 'Y') return false;
      return !uploadedMap.get(Number(item.id));
    });

    if (missing.length) {
      throw new BadRequestException(
        `Missing mandatory documents: ${missing.map((item: any) => item.name).join(', ')}`,
      );
    }
  }

  private async saveBuilderDraftInternal(
    userId: number,
    dto: SaveProgressDto,
    ipAddress: string,
    userAgent: string,
  ) {
    const service = await this.prisma.service.findFirst({
      where: { service_id: dto.serviceId },
      select: { department_id: true, service_name: true, swcs_service_id: true },
    });
    if (!service) {
      throw new NotFoundException('Service not found');
    }

    const department = service.department_id
      ? await this.prisma.department.findUnique({
        where: { id: service.department_id },
        select: { uniqueTag: true },
      })
      : null;

    const sanitizedFormData = this.sanitizeBuilderFormData(dto.formData, dto.currentStep);
    const unitName = this.resolveBuilderUnitName(sanitizedFormData, service.service_name);
    const landrigionId = await this.resolveBuilderLandRegionId(dto.serviceId, sanitizedFormData);
    const now = new Date();

    let submission = null as any;
    const requestedSubmissionId = Number(dto.submissionId || 0);
    if (requestedSubmissionId > 0) {
      submission = await this.prisma.applicationSubmission.findFirst({
        where: {
          submissionId: requestedSubmissionId,
          userId: BigInt(userId),
          serviceId: dto.serviceId,
        },
      });
      if (!submission) {
        throw new BadRequestException('Draft submission not found.');
      }

      submission = await this.prisma.applicationSubmission.update({
        where: { submissionId: requestedSubmissionId },
        data: {
          fieldValue: sanitizedFormData,
          formId: dto.formTypeId,
          deptId: service.department_id ?? 0,
          parentSubId: dto.cafId ? Number(dto.cafId) : submission.parentSubId || 0,
          landrigionId,
          applicationStatus: 'I',
          unitName,
          applicationUpdatedDateTime: now,
          ipAddress,
          userAgent,
          processingLevel: submission.processingLevel || 'District',
        },
      });
    } else {
      submission = await this.prisma.applicationSubmission.create({
        data: {
          serviceId: dto.serviceId,
          userId: BigInt(userId),
          applicationStatus: 'I',
          fieldValue: sanitizedFormData,
          formId: dto.formTypeId,
          deptId: service.department_id ?? 0,
          parentSubId: dto.cafId ? Number(dto.cafId) : 0,
          landrigionId,
          unitName,
          processingLevel: 'District',
          applicationCreatedDate: now,
          applicationUpdatedDateTime: now,
          ipAddress,
          userAgent,
        },
      });
    }

    let spApp = await this.prisma.spApplication.findFirst({
      where: { appId: BigInt(submission.submissionId) },
      select: { sno: true },
    });

    const spPayload = {
      spTag: department?.uniqueTag || '',
      spAppId: service.swcs_service_id ? String(service.swcs_service_id) : dto.serviceId,
      appId: BigInt(submission.submissionId),
      appName: service.service_name || 'Service Application',
      appFields: {},
      appStatus: 'I',
      appComments: `Draft saved at step ${Number(dto.currentStep ?? 0) + 1}`,
      appDistt: landrigionId ? String(landrigionId) : '0',
      appDisttName: '',
      appLocation: '',
      isAppliedByCaf: null as any,
      cafId: dto.cafId ? Number(dto.cafId) : 0,
      cafType: null as string | null,
      unitName: unitName || '',
      revertedCallBackUrl: this.buildBuilderEditUrl(dto.serviceId, dto.formTypeId, submission.submissionId),
      printAppCallBackUrl: `/investor/applications/${submission.submissionId}`,
      downloadCertificateCallBackUrl: '',
      userId: BigInt(userId),
      updatedOn: now,
      isActive: 'Y' as any,
      remoteServer: ipAddress || '',
      userAgent: userAgent || '',
      param1: BigInt(0),
      param2: '',
      param3: '',
      param4: '',
      param5: '',
      isOfflineApplication: 'N' as any,
      isUploadedSignedCertificate: 'N' as any,
      deemedApproved: '0',
    };

    if (!spApp?.sno) {
      const created = await this.prisma.spApplication.create({
        data: {
          ...spPayload,
          createdOn: now,
        },
        select: { sno: true },
      });
      spApp = created;
    } else {
      await this.prisma.spApplication.update({
        where: { sno: spApp.sno },
        data: spPayload,
      });
    }

    const user = await this.prisma.users.findUnique({
      where: { id: Number(userId) as any },
      select: { role_id: true },
    });

    await this.createBuilderHistory({
      sno: spApp?.sno ?? null,
      serviceId: dto.serviceId,
      spTag: department?.uniqueTag || '',
      submissionId: submission.submissionId,
      status: 'I',
      comments: `Draft saved at step ${Number(dto.currentStep ?? 0) + 1}`,
      roleId: Number(user?.role_id || 0) || null,
      ipAddress,
      userAgent,
    });

    return {
      success: true,
      submissionId: Number(submission.submissionId),
      status: 'I',
      redirectToDocuments: this.buildBuilderDocumentsUrl(
        dto.serviceId,
        dto.formTypeId,
        Number(submission.submissionId),
      ),
    };
  }

  async markDocumentsProgress(
    userId: number,
    dto: FinalSubmitDto,
    ipAddress: string = '127.0.0.1',
    userAgent: string = 'System',
  ) {
    const submission = await this.prisma.applicationSubmission.findFirst({
      where: {
        submissionId: dto.submissionId,
        userId: BigInt(userId),
        serviceId: dto.serviceId,
      },
      select: {
        submissionId: true,
        serviceId: true,
        formId: true,
        parentSubId: true,
        unitName: true,
        landrigionId: true,
        applicationStatus: true,
      },
    });
    if (!submission) {
      throw new BadRequestException('Draft submission not found.');
    }

    const currentStatus = String(submission.applicationStatus || '').toUpperCase();
    if (!['I', 'DP', 'PD', 'RBI'].includes(currentStatus)) {
      throw new BadRequestException('Application is not editable in current status.');
    }

    const service = await this.prisma.service.findFirst({
      where: { service_id: dto.serviceId },
      select: { department_id: true, service_name: true, swcs_service_id: true },
    });
    if (!service) {
      throw new NotFoundException('Service not found.');
    }

    const department = service.department_id
      ? await this.prisma.department.findUnique({
        where: { id: service.department_id },
        select: { uniqueTag: true },
      })
      : null;

    const now = new Date();
    const nextStatus = 'DP';
    const nextComments = 'Documents page opened';

    const updatedSubmission =
      currentStatus === nextStatus
        ? submission
        : await this.prisma.applicationSubmission.update({
          where: { submissionId: dto.submissionId },
          data: {
            applicationStatus: nextStatus,
            applicationUpdatedDateTime: now,
            ipAddress,
            userAgent,
          },
          select: {
            submissionId: true,
            serviceId: true,
            formId: true,
            parentSubId: true,
            unitName: true,
            landrigionId: true,
            applicationStatus: true,
          },
        });

    let spApp = await this.prisma.spApplication.findFirst({
      where: { appId: BigInt(dto.submissionId) },
      select: { sno: true, appStatus: true },
    });

    if (!spApp?.sno) {
      const created = await this.prisma.spApplication.create({
        data: {
          spTag: department?.uniqueTag || '',
          spAppId: service.swcs_service_id ? String(service.swcs_service_id) : dto.serviceId,
          appId: BigInt(dto.submissionId),
          appName: service.service_name || 'Service Application',
          appFields: {},
          appStatus: nextStatus,
          appComments: nextComments,
          appDistt: updatedSubmission.landrigionId ? String(updatedSubmission.landrigionId) : '0',
          appDisttName: '',
          appLocation: '',
          isAppliedByCaf: null,
          cafId: Number(updatedSubmission.parentSubId || 0),
          cafType: null,
          unitName: updatedSubmission.unitName || service.service_name || '',
          revertedCallBackUrl: this.buildBuilderEditUrl(dto.serviceId, dto.formTypeId, dto.submissionId),
          printAppCallBackUrl: `/investor/applications/${dto.submissionId}`,
          downloadCertificateCallBackUrl: '',
          userId: BigInt(userId),
          createdOn: now,
          updatedOn: now,
          isActive: 'Y',
          remoteServer: ipAddress || '',
          userAgent: userAgent || '',
          param1: BigInt(0),
          param2: '',
          param3: '',
          param4: '',
          param5: '',
          isOfflineApplication: 'N',
          isUploadedSignedCertificate: 'N',
          deemedApproved: '0',
        },
        select: { sno: true, appStatus: true },
      });
      spApp = created;
    } else if (String(spApp.appStatus || '').toUpperCase() !== nextStatus) {
      spApp = await this.prisma.spApplication.update({
        where: { sno: spApp.sno },
        data: {
          appStatus: nextStatus,
          appComments: nextComments,
          appDistt: updatedSubmission.landrigionId ? String(updatedSubmission.landrigionId) : '0',
          updatedOn: now,
          remoteServer: ipAddress || '',
          userAgent: userAgent || '',
        },
        select: { sno: true, appStatus: true },
      });
    }

    if (currentStatus !== nextStatus) {
      const user = await this.prisma.users.findUnique({
        where: { id: Number(userId) as any },
        select: { role_id: true },
      });

      await this.createBuilderHistory({
        sno: spApp?.sno ?? null,
        serviceId: dto.serviceId,
        spTag: department?.uniqueTag || '',
        submissionId: dto.submissionId,
        status: nextStatus,
        comments: nextComments,
        roleId: Number(user?.role_id || 0) || null,
        ipAddress,
        userAgent,
      });
    }

    return {
      success: true,
      submissionId: dto.submissionId,
      status: nextStatus,
    };
  }

  private async loadMasterTableOptionsById(
    masterDefinitionId: number,
    parentValue?: any,
    query?: { q?: string; take?: number; includeInactive?: boolean },
  ): Promise<Array<{ label: string; value: string }>> {
    const def = await this.prisma.masterDefinition.findUnique({ where: { id: masterDefinitionId } });
    if (!def) return [];

    const take = typeof query?.take === 'number' && query.take > 0 ? Math.min(query.take, 20000) : 5000;
    const where: any = { master_id: masterDefinitionId, is_active: true };
    const normalizedParentValues =
      parentValue !== undefined && parentValue !== null && parentValue !== ''
        ? Array.isArray(parentValue)
          ? parentValue.flatMap((x: any) => (typeof x === 'string' ? x.split(',') : [String(x)])).map((x: string) => x.trim()).filter(Boolean)
          : [String(parentValue).trim()].filter(Boolean)
        : [];
    let shouldFilterByParentData = false;
    let triedReferenceFilter = false;
    const parentCodes = [def.parent_master_code]
      .filter((code): code is string => typeof code === 'string' && code.trim().length > 0)
      .map((code) => code.trim().toLowerCase());

    // Cascading: master_data_reference stores child(from_data_id) -> parent(to_data_id).
    // Keep parent -> child support too for older data that may have been generated in the opposite direction.
    if (parentValue !== undefined && parentValue !== null && parentValue !== '') {
      const parentBigInts: bigint[] = normalizedParentValues.reduce<bigint[]>((acc, v) => {
        try { acc.push(BigInt(v)); } catch { /* skip */ }
        return acc;
      }, []);

      if (parentBigInts.length > 0) {
        const parentIdSet = new Set(parentBigInts.map((id) => id.toString()));
        const refs = await this.prisma.masterDataReference.findMany({
          where: {
            OR: [
              { to_data_id: { in: parentBigInts } },
              { from_data_id: { in: parentBigInts } },
            ],
          },
          select: { from_data_id: true, to_data_id: true },
        });
        const childIds = Array.from(new Set(
          refs
            .map((r) => (parentIdSet.has(r.to_data_id.toString()) ? r.from_data_id : r.to_data_id))
            .map((id) => id.toString()),
        )).map((id) => BigInt(id));
        if (childIds.length > 0) {
          triedReferenceFilter = true;
          where.id = { in: childIds };
        } else {
          shouldFilterByParentData = true;
        }
      } else {
        shouldFilterByParentData = true;
      }
    }

    let records = await this.prisma.masterData.findMany({
      where,
      select: { id: true, data: true },
      take,
      orderBy: { id: 'asc' },
    });

    if (triedReferenceFilter && records.length === 0 && normalizedParentValues.length > 0) {
      delete where.id;
      shouldFilterByParentData = true;
      records = await this.prisma.masterData.findMany({
        where,
        select: { id: true, data: true },
        take,
        orderBy: { id: 'asc' },
      });
    }

    // Optional search filter
    const q = query?.q?.trim();
    if (q) {
      const qLower = q.toLowerCase();
      records = records.filter((r) => String((r.data as any)?.name ?? '').toLowerCase().includes(qLower));
    }

    if (shouldFilterByParentData && normalizedParentValues.length > 0) {
      const parentValueSet = new Set(normalizedParentValues.map((v) => String(v).trim()));
      const candidateKeys = new Set<string>(['parent_id', 'parentId', 'parent_master_id']);
      parentCodes.forEach((code) => {
        const compact = code.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        if (!compact) return;
        candidateKeys.add(compact);
        candidateKeys.add(`${compact}_id`);
        candidateKeys.add(`${compact}Id`);
      });

      records = records.filter((r) => {
        const data = (r.data as any) ?? {};
        return Array.from(candidateKeys).some((key) => {
          const raw = data?.[key];
          const vals = Array.isArray(raw) ? raw : [raw];
          return vals.some((v) => parentValueSet.has(String(v ?? '').trim()));
        });
      });
    }

    return records.map((r) => ({
      label: (r.data as any)?.name ?? String(r.id),
      value: String(r.id),
    }));
  }

  // ✅ RESTORED: Helper to map UI category to DB values
  private getCategoryLabel(type: string): string {
    switch (type) {
      case 'pre-establishment': return 'Pre-Establishment';
      case 'pre-operation': return 'Pre-Operation';
      case 'post-operation': return 'Post-Operation';
      default: return 'Pre-Establishment';
    }
  }

  private normalizeCategoryToken(value: string) {
    return String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
  }

  private isLifecycleCategory(value: string) {
    const v = this.normalizeCategoryToken(value);
    return v.includes('preestablishment') || v.includes('preoperation') || v.includes('postoperation');
  }

  private categoryMatchesRequested(rawCategory: string, requestedCategory: string) {
    const category = this.normalizeCategoryToken(rawCategory);
    const requested = this.normalizeCategoryToken(requestedCategory);
    if (!category) return true;
    if (!this.isLifecycleCategory(category)) return true;
    return category.includes(requested);
  }

  async getDepartments() {
    return this.prisma.department.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true }
    });
  }

  async getServices(departmentId: number, categoryType: string, locale?: string) {
    const normalizedLocale = this.normalizeLocale(locale);
    const normalizeServiceId = (id: string | null | undefined) => String(id ?? '').trim().replace(/\.0$/, '');
    const normalizedCategory = String(categoryType || '').trim().toLowerCase();
    const requiredServiceLevel =
      normalizedCategory === 'pre-establishment'
        ? '1'
        : normalizedCategory === 'pre-operation'
          ? '2'
          : normalizedCategory === 'post-operation'
            ? '3'
            : null;

    // 1) Base list from department services (same source as admin page)
    const services = await this.prisma.service.findMany({
      where: {
        department_id: departmentId,
        isActive: true,
        ...(requiredServiceLevel ? { service_level: requiredServiceLevel } : {}),
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        service_id: true,
        service_name: true,
        nameInHindi: true,
        is_caf_required: true,
        service_level: true,
      },
    });

    if (services.length === 0) return [];

    const serviceIdCandidates = Array.from(
      new Set(
        services.flatMap((service) => {
          const raw = String(service.service_id ?? '').trim();
          const base = normalizeServiceId(raw);
          return [raw, base, `${base}.0`].filter(Boolean);
        }),
      ),
    );

    // 2) Fetch mappings for these services (department-specific first, then shared)
    const formMappings = await this.prisma.formMapping.findMany({
      where: {
        OR: [{ department_id: departmentId }, { department_id: 0 }],
        is_active: YnFlag.Y,
        service_id: { in: serviceIdCandidates },
      },
      orderBy: [{ department_id: 'desc' }, { form_type_id: 'asc' }, { id: 'desc' }],
      select: { service_id: true, form_type_id: true, form_name: true } // ✅ Also fetch form_name
    });

    // Pick one preferred mapping per service (avoid repeated service rows)
    const preferredMappings = new Map<string, { form_type_id: number; form_name: string | null }>();
    for (const mapping of formMappings) {
      const normalizedId = normalizeServiceId(mapping.service_id);
      if (!preferredMappings.has(normalizedId)) {
        preferredMappings.set(normalizedId, {
          form_type_id: mapping.form_type_id,
          form_name: mapping.form_name ?? null,
        });
      }
    }

    // 3. Fetch Service Details (Timeline, Fee, etc.)
    const serviceDetails = await this.prisma.serviceDetail.findMany({
      where: { serviceId: { in: serviceIdCandidates } },
      select: { serviceId: true, timeline: true, feeStructureDocument: true, serviceCategory: true }
    });

    // 4. Create Maps for instant lookup
    const detailsMapByNormalizedId = new Map<string, (typeof serviceDetails)[number]>();
    serviceDetails.forEach((detail) => {
      const key = normalizeServiceId(detail.serviceId);
      if (!detailsMapByNormalizedId.has(key)) {
        detailsMapByNormalizedId.set(key, detail);
      }
    });

    // 5. Merge Data - iterate department services (one row per service)
    let mappedServices = services.map((s) => {
      const normalizedId = normalizeServiceId(s.service_id);
      const mapping = preferredMappings.get(normalizedId);
      const details = detailsMapByNormalizedId.get(normalizedId);
      const localizedServiceName = this.resolveServiceNameByLocale(
        normalizedLocale,
        { service_name: s.service_name, nameInHindi: (s as any).nameInHindi },
      );

      // Combine Service Name + Form Name only when they differ.
      const mappedFormName = String(mapping?.form_name || '').trim();
      const displayName =
        mappedFormName && mappedFormName.toLowerCase() !== localizedServiceName.toLowerCase()
          ? `${localizedServiceName} (${mappedFormName})`
          : localizedServiceName;

      return {
        id: `${s.id}_${mapping?.form_type_id ?? 0}`,
        serviceCode: s.service_id ?? '',
        name: displayName,
        fee: details?.feeStructureDocument ?? 'As per rules',
        timeline: details?.timeline ? `${details.timeline} Days` : 'Not Specified',
        formTypeId: mapping?.form_type_id ?? 0,
        firstPageId: null as number | null,
        isCafRequired: s.is_caf_required ?? false,
        category: details?.serviceCategory || ''
      };
    });

    const pagePairs = mappedServices
      .filter((service) => service.formTypeId)
      .map((service) => ({
        serviceId: String(service.serviceCode),
        formId: Number(service.formTypeId),
      }));

    if (pagePairs.length) {
      const pageRows = await this.prisma.formPageMaster.findMany({
        where: {
          OR: pagePairs.map((item) => ({
            service_id: item.serviceId,
            form_id: item.formId,
            is_active: YnFlag.Y,
          })),
        },
        orderBy: [{ service_id: 'asc' }, { form_id: 'asc' }, { preference: 'asc' }],
        select: { service_id: true, form_id: true, id: true },
      });

      const firstPageMap = new Map<string, number>();
      for (const row of pageRows) {
        const key = `${row.service_id}__${row.form_id}`;
        if (!firstPageMap.has(key)) {
          firstPageMap.set(key, row.id);
        }
      }

      mappedServices = mappedServices.map((service) => ({
        ...service,
        firstPageId: service.formTypeId
          ? (firstPageMap.get(`${service.serviceCode}__${service.formTypeId}`) ?? null)
          : null,
      }));
    }

    return mappedServices;
  }

  async getApprovedCAFs(userId: number) {
    if (!userId || isNaN(userId)) return [];

    const cafs = await this.prisma.applicationSubmission.findMany({
      where: {
        userId: BigInt(userId),
        serviceId: { in: ['591.0', '943.0'] }, // Both old and new CAF service IDs
        applicationStatus: 'A' // Approved
      },
      select: { submissionId: true, unitName: true }
    });

    return cafs.map(c => ({
      cafId: c.submissionId.toString(),
      label: c.unitName ? `${c.unitName} (CAF ID: ${c.submissionId})` : `CAF ID - ${c.submissionId}`
    }));
  }

  async saveProgress(
    userId: number,
    dto: SaveProgressDto,
    ipAddress: string = '127.0.0.1',
    userAgent: string = 'System',
  ) {
    return this.saveBuilderDraftInternal(userId, dto, ipAddress, userAgent);
  }

  async getDraft(submissionId: number, userId: number) {
    const submission = await this.prisma.applicationSubmission.findFirst({
      where: {
        submissionId,
        userId: BigInt(userId),
      },
      select: {
        submissionId: true,
        serviceId: true,
        formId: true,
        deptId: true,
        applicationStatus: true,
        fieldValue: true,
        unitName: true,
        applicationCreatedDate: true,
        applicationUpdatedDateTime: true,
      },
    });

    if (!submission) {
      throw new NotFoundException('Draft submission not found.');
    }

    const status = String(submission.applicationStatus || '').toUpperCase();
    if (!['I', 'DP', 'PD', 'RBI', 'H'].includes(status)) {
      throw new BadRequestException('Application is not editable in current status.');
    }

    return {
      submissionId: Number(submission.submissionId),
      serviceId: submission.serviceId,
      formTypeId: submission.formId,
      departmentId: submission.deptId,
      status,
      formData: submission.fieldValue || { fields: {}, addMore: {}, repeatablePages: {} },
      unitName: submission.unitName || '',
      applicationCreatedDate: submission.applicationCreatedDate,
      applicationUpdatedDateTime: submission.applicationUpdatedDateTime,
    };
  }

  async getEditableSubmission(options: {
    userId: number;
    serviceId: string;
    formTypeId?: number;
    cafId?: number;
  }) {
    const editableStatuses = ['I', 'DP', 'PD', 'RBI'];
    const serviceId = String(options.serviceId || '').trim();
    if (!serviceId) {
      throw new BadRequestException('serviceId is required.');
    }

    const submissions = await this.prisma.applicationSubmission.findMany({
      where: {
        userId: BigInt(options.userId),
        serviceId,
        ...(Number.isFinite(options.formTypeId) && Number(options.formTypeId) > 0
          ? { formId: Number(options.formTypeId) }
          : {}),
        ...(Number.isFinite(options.cafId) && Number(options.cafId) > 0
          ? { parentSubId: Number(options.cafId) }
          : {}),
      },
      orderBy: [{ applicationUpdatedDateTime: 'desc' }, { submissionId: 'desc' }],
      select: {
        submissionId: true,
        serviceId: true,
        formId: true,
        parentSubId: true,
        applicationStatus: true,
        applicationUpdatedDateTime: true,
      },
    });

    if (!submissions.length) {
      return null;
    }

    const spApplications = await this.prisma.spApplication.findMany({
      where: {
        userId: BigInt(options.userId),
        appId: { in: submissions.map((item) => BigInt(item.submissionId)) },
        appStatus: { in: editableStatuses },
      },
      orderBy: [{ updatedOn: 'desc' }, { sno: 'desc' }],
      select: {
        appId: true,
        appStatus: true,
        cafId: true,
        updatedOn: true,
      },
    });

    const spBySubmissionId = new Map<number, (typeof spApplications)[number]>();
    for (const row of spApplications) {
      const submissionId = Number(row.appId);
      if (!spBySubmissionId.has(submissionId)) {
        spBySubmissionId.set(submissionId, row);
      }
    }

    const matched = submissions.find((submission) => {
      const linkedSpApplication = spBySubmissionId.get(Number(submission.submissionId));
      const submissionStatus = String(submission.applicationStatus || '').toUpperCase();
      return Boolean(linkedSpApplication) || editableStatuses.includes(submissionStatus);
    });

    if (!matched) {
      return null;
    }

    const linkedSpApplication = spBySubmissionId.get(Number(matched.submissionId));
    return {
      submissionId: Number(matched.submissionId),
      serviceId: matched.serviceId,
      formTypeId: matched.formId ? Number(matched.formId) : null,
      cafId: Number(linkedSpApplication?.cafId ?? matched.parentSubId ?? 0) || null,
      status: String(
        linkedSpApplication?.appStatus || matched.applicationStatus || '',
      ).toUpperCase(),
      updatedAt:
        linkedSpApplication?.updatedOn || matched.applicationUpdatedDateTime || null,
    };
  }

  async finalSubmit(
    userId: number,
    dto: FinalSubmitDto,
    ipAddress: string = '127.0.0.1',
    userAgent: string = 'System',
  ) {
    const submission = await this.prisma.applicationSubmission.findFirst({
      where: {
        submissionId: dto.submissionId,
        userId: BigInt(userId),
        serviceId: dto.serviceId,
      },
    });
    if (!submission) {
      throw new BadRequestException('Draft submission not found.');
    }

    const service = await this.prisma.service.findFirst({
      where: { service_id: dto.serviceId },
      select: { department_id: true, service_name: true, swcs_service_id: true },
    });
    if (!service) {
      throw new NotFoundException('Service not found.');
    }

    const isMarriageService = String(dto.serviceId) === '968.0' || String(dto.serviceId) === '968';

    if (!isMarriageService) {
      await this.validateMandatoryDocuments(dto.submissionId, dto.serviceId, userId);
    }

    await this.commonDocumentService.syncDocumentMappings({
      submissionId: dto.submissionId,
      userId: BigInt(userId),
      serviceId: dto.serviceId,
      deptId: Number(service.department_id || 0),
      ipAddress,
      userAgent,
    });

    const now = new Date();
    const department = service.department_id
      ? await this.prisma.department.findUnique({
        where: { id: service.department_id },
        select: { uniqueTag: true },
      })
      : null;
    const spTag = department?.uniqueTag || '';

    const user = await this.prisma.users.findUnique({
      where: { id: Number(userId) as any },
      select: { role_id: true, tenant_id: true },
    });

    const processingLevel = String(submission.processingLevel || 'District');
    const workflowConfig = await this.prisma.applicationWorkflowConfiguration.findFirst({
      where: {
        departmentId: Number(service.department_id || 0),
        serviceId: dto.serviceId,
        processingLevel: processingLevel as any,
        currentRoleId: Number(user?.role_id || 0),
        formTypeId: dto.formTypeId || submission.formId || 1,
      },
      orderBy: { step: 'asc' },
    });

    // ── Resolve nextRoleId via transition_map_json (SUBMIT action) ────────────
    let nextRoleId: number | null = workflowConfig?.nextRoleId || null;
    if (workflowConfig?.transitionMapJson) {
      const transitionMap = (workflowConfig.transitionMapJson as Record<string, any>);
      const submitKey = Object.keys(transitionMap).find(
        (k) => k.toUpperCase() === 'SUBMIT' || k.toUpperCase() === 'P',
      );
      if (submitKey) {
        const transition = transitionMap[submitKey];
        // Handle both formats: nextRoleId (single) and next_roles (array)
        let resolved = Number(transition?.nextRoleId ?? transition?.next_role_id ?? NaN);
        if (!Number.isFinite(resolved) || resolved <= 0) {
          // If not found, try to get first role from next_roles array
          const nextRoles = transition?.next_roles ?? transition?.nextRoles;
          if (Array.isArray(nextRoles) && nextRoles.length > 0) {
            resolved = Number(nextRoles[0]);
          }
        }
        if (Number.isFinite(resolved) && resolved > 0) nextRoleId = resolved;
      }
    }

    const verifierUserId = workflowConfig?.approverId || null;
    const forwardedDistId = Number(submission.landrigionId || 0) || 0;
    const assignmentStrategy = String(workflowConfig?.assignmentStrategy || 'ROLE').toUpperCase();
    const jurisdictionLevel = String(workflowConfig?.jurisdictionLevel || 'DISTRICT').toUpperCase();

    // ── Resolve next officer based on assignment_strategy ─────────────────────
    let nextOfficer: any = null;
    if (nextRoleId) {
      if (assignmentStrategy === 'ROLE') {
        // Find officer by role within the department, optionally matching district
        const districtFilter = jurisdictionLevel === 'DISTRICT' && forwardedDistId
          ? { district_id: forwardedDistId }
          : {};
        nextOfficer = await this.prisma.department_users.findFirst({
          where: {
            dept_id: Number(service.department_id || 0),
            ...districtFilter,
            user: { role_id: nextRoleId },
          },
          include: { user: true },
        });
      } else if (assignmentStrategy === 'USER') {
        // Specific user assigned via approverId
        if (verifierUserId) {
          nextOfficer = await this.prisma.department_users.findFirst({
            where: { user_id: BigInt(verifierUserId) },
            include: { user: true },
          });
        }
      } else if (assignmentStrategy === 'OFFICE') {
        // Any officer in the department with the required role (no district filter)
        nextOfficer = await this.prisma.department_users.findFirst({
          where: {
            dept_id: Number(service.department_id || 0),
            user: { role_id: nextRoleId },
          },
          include: { user: true },
        });
      }
      // RULE strategy: nextOfficer resolved via assignmentRuleJson — not yet implemented
    }

    // Only save nextUserId for USER strategy (assignment_strategy_id = 2)
    // For ROLE/OFFICE, leave null so any matching officer in the dept can claim it
    const nextUserId = assignmentStrategy === 'USER' && nextOfficer?.user_id
      ? Number(nextOfficer.user_id)
      : null;
    const forwardedDeptId = nextOfficer?.dept_id ?? Number(service.department_id || 0);
    const resolvedForwardedDistId = nextOfficer?.district_id ?? forwardedDistId;

    await this.prisma.applicationSubmission.update({
      where: { submissionId: dto.submissionId },
      data: {
        applicationStatus: 'P',
        approvalId: nextRoleId,
        submittedOn: now,
        applicationUpdatedDateTime: now,
        ipAddress,
        userAgent,
      },
    });

    let spApp = await this.prisma.spApplication.findFirst({
      where: { appId: BigInt(dto.submissionId) },
      select: { sno: true },
    });

    if (!spApp?.sno) {
      const created = await this.prisma.spApplication.create({
        data: {
          spTag,
          spAppId: service.swcs_service_id ? String(service.swcs_service_id) : dto.serviceId,
          appId: BigInt(dto.submissionId),
          appName: service.service_name || 'Service Application',
          appFields: {},
          appStatus: 'P',
          appComments: 'Application submitted',
          appDistt: resolvedForwardedDistId ? String(resolvedForwardedDistId) : '0',
          appDisttName: '',
          appLocation: '',
          isAppliedByCaf: null,
          cafId: Number(submission.parentSubId || 0),
          cafType: null,
          unitName: submission.unitName || service.service_name || '',
          revertedCallBackUrl: this.buildBuilderEditUrl(dto.serviceId, dto.formTypeId, dto.submissionId),
          printAppCallBackUrl: `/investor/applications/${dto.submissionId}`,
          downloadCertificateCallBackUrl: '',
          userId: BigInt(userId),
          createdOn: now,
          updatedOn: now,
          isActive: 'Y',
          remoteServer: ipAddress || '',
          userAgent: userAgent || '',
          param1: BigInt(0),
          param2: '',
          param3: '',
          param4: '',
          param5: '',
          isOfflineApplication: 'N',
          isUploadedSignedCertificate: 'N',
          deemedApproved: '0',
        },
        select: { sno: true },
      });
      spApp = created;
    } else {
      await this.prisma.spApplication.update({
        where: { sno: spApp.sno },
        data: {
          appStatus: 'P',
          appComments: 'Application submitted',
          updatedOn: now,
          remoteServer: ipAddress || '',
          userAgent: userAgent || '',
        },
      });
    }

    await this.createBuilderHistory({
      sno: spApp?.sno ?? null,
      serviceId: dto.serviceId,
      spTag,
      submissionId: dto.submissionId,
      status: 'P',
      comments: 'Application submitted by investor',
      roleId: Number(user?.role_id || 0) || null,
      nextRoleId,
      ipAddress,
      userAgent,
    });

    // ── V2 Workflow Engine Trigger ─────────────────────────────────────────────
    // Replace legacy forwardApplication insert with V2 engine startInstance.
    // If no V2 workflow is published for this service, fall back to legacy.
    let v2Started = false;
    try {
      await this.workflowEngine.startInstance({
        tenantId: (user as any)?.tenant_id || 1,
        departmentId: Number(service.department_id || 0),
        serviceId: dto.serviceId,
        applicationId: BigInt(dto.submissionId),
        actorUserId: BigInt(userId),
      });
      v2Started = true;
      this.logger.log(`V2 workflow started for submission ${dto.submissionId}, service ${dto.serviceId}`);
    } catch (err: any) {
      // If no published V2 workflow exists, fall back to legacy forwardApplication
      this.logger.warn(`V2 workflow not available for service ${dto.serviceId}: ${err.message}. Falling back to legacy.`);
    }

    if (!v2Started) {
      // Legacy fallback: create forwardApplication row
      await this.prisma.forwardApplication.create({
        data: {
          nextRoleId,
          nextUserId,
          verifierUserId: verifierUserId ? Number(verifierUserId) : null,
          appSubId: dto.submissionId,
          forwardedDeptId,
          forwardedDistId: resolvedForwardedDistId || 0,
          formId: dto.formTypeId || submission.formId || null,
          postInfo: 'Application submitted by investor',
          actionTaken: null,
          actionStatus: 'P',
          verifierUserComment: null,
          supportiveDocument: null,
          createdOn: now,
          updatedDateTime: null,
          userAgent: userAgent || '',
          commentDate: null,
          inspectionDate: null,
          inspectionStartDate: null,
          inspectionEndDate: null,
          reasonForDelay: null,
          supportDocument: null,
          inspectionReport: null,
          educationAakhyaDocument: null,
          ipAddress: ipAddress || '',
          approvStatus: 'P',
          scrutinyCommitteeMeetingDate: null,
          claimReceipt: null,
          lineDeptCafApprovalStatus: null,
          geoReport: null,
          megaIncentiveClaimedAmount: null,
          rowRejectionCode: null,
          evaluationMatrixDocument: null,
        },
      });
    }

    return {
      success: true,
      submissionId: dto.submissionId,
      status: 'P',
      message: 'Application submitted successfully.',
    };
  }

  async submitApplication(userId: number, dto: any, ipAddress: string = '127.0.0.1', userAgent: string = 'System') {
    const service = await this.prisma.service.findFirst({
      where: { service_id: dto.serviceId },
      select: { department_id: true, service_name: true },
    });

    let submission: any = null;
    const requestedSubmissionId = Number(dto.submissionId || 0);

    if (requestedSubmissionId > 0) {
      const existing = await this.prisma.applicationSubmission.findFirst({
        where: {
          submissionId: requestedSubmissionId,
          userId: BigInt(userId),
          serviceId: dto.serviceId,
        },
        select: { submissionId: true },
      });
      if (!existing) {
        throw new BadRequestException('Draft submission not found.');
      }

      submission = await this.prisma.applicationSubmission.update({
        where: { submissionId: requestedSubmissionId },
        data: {
          applicationStatus: 'P',
          fieldValue: dto.formData,
          formId: dto.formTypeId,
          deptId: service?.department_id ?? 0,
          parentSubId: dto.cafId ? Number(dto.cafId) : 0,
          landrigionId: 0,
          ipAddress: ipAddress,
          userAgent: userAgent,
        },
      });
    } else {
      submission = await this.prisma.applicationSubmission.create({
        data: {
          serviceId: dto.serviceId,
          userId: BigInt(userId),
          applicationStatus: 'P',
          fieldValue: dto.formData,
          formId: dto.formTypeId,
          deptId: service?.department_id ?? 0,
          parentSubId: dto.cafId ? Number(dto.cafId) : 0,
          landrigionId: 0,
          ipAddress: ipAddress,
          userAgent: userAgent,
        }
      });
    }

    await this.ensureSpApplication({
      submissionId: Number(submission.submissionId),
      serviceId: String(dto.serviceId),
      formTypeId: Number(dto.formTypeId || 1),
      userId: Number(userId),
      parentSubId: dto.cafId ? Number(dto.cafId) : 0,
      unitName: submission?.unitName || service?.service_name || '',
      ipAddress,
      userAgent,
    });

    await this.commonDocumentService.syncDocumentMappings({
      submissionId: Number(submission.submissionId),
      userId: BigInt(userId),
      serviceId: String(dto.serviceId),
      deptId: Number(service?.department_id || 0),
      ipAddress,
      userAgent,
    });

    return {
      success: true,
      submissionId: submission.submissionId.toString(),
      message: 'Application submitted successfully'
    };
  }

  async createOrGetDraft(
    userId: number,
    dto: DraftApplicationDto,
    ipAddress: string = '127.0.0.1',
    userAgent: string = 'System',
  ) {
    const service = await this.prisma.service.findFirst({
      where: { service_id: dto.serviceId },
      select: { department_id: true },
    });

    const existing = await this.prisma.applicationSubmission.findFirst({
      where: {
        userId: BigInt(userId),
        serviceId: dto.serviceId,
        formId: dto.formTypeId,
        applicationStatus: 'I',
        parentSubId: dto.cafId ? Number(dto.cafId) : 0,
      },
      orderBy: { submissionId: 'desc' },
      select: { submissionId: true },
    });

    if (existing?.submissionId) {
      return {
        success: true,
        submissionId: Number(existing.submissionId),
        status: 'I',
      };
    }

    const created = await this.prisma.applicationSubmission.create({
      data: {
        serviceId: dto.serviceId,
        userId: BigInt(userId),
        applicationStatus: 'I',
        fieldValue: { fields: {}, addMore: {} },
        formId: dto.formTypeId,
        deptId: service?.department_id ?? 0,
        parentSubId: dto.cafId ? Number(dto.cafId) : 0,
        landrigionId: 0,
        ipAddress: ipAddress,
        userAgent: userAgent,
      },
      select: { submissionId: true, applicationStatus: true },
    });

    return {
      success: true,
      submissionId: Number(created.submissionId),
      status: created.applicationStatus,
    };
  }

  private async loadMasterOptions(masterDefinitionId: number): Promise<Array<{ label: string; value: string }>> {
    const def = await this.prisma.masterDefinition.findUnique({ where: { id: masterDefinitionId } });
    if (!def) return [];
    const records = await this.prisma.masterData.findMany({
      where: { master_id: masterDefinitionId, is_active: true },
      select: { id: true, data: true },
      take: 5000,
      orderBy: { id: 'asc' },
    });
    return records.map((r) => ({
      label: (r.data as any)?.name ?? String(r.id),
      value: String(r.id),
    }));
  }

  async getMasterTableOptions(
    masterTableId: number,
    parentValue?: string | string[],
    query?: { q?: string; take?: number; includeInactive?: boolean },
  ) {
    let normalized: any = parentValue;
    if (typeof parentValue === 'string' && parentValue.includes(',')) {
      normalized = parentValue.split(',').map((x) => x.trim()).filter(Boolean);
    }
    return this.loadMasterTableOptionsById(masterTableId, normalized, query);
  }

  async getFormConfig(serviceId: string, formTypeId: number, locale?: string) {
    const normalizedLocale = this.normalizeLocale(locale);
    const serviceIdCandidates = Array.from(new Set([
      serviceId,
      serviceId?.endsWith('.0') ? serviceId.replace(/\.0$/, '') : `${serviceId}.0`,
    ].filter(Boolean)));
    const mapping = await this.prisma.formMapping.findFirst({
      where: { service_id: { in: serviceIdCandidates }, form_type_id: formTypeId, is_active: YnFlag.Y }
    });

    if (!mapping) throw new NotFoundException('Form not found for this service.');

    const service = await this.prisma.service.findFirst({
      where: { service_id: { in: serviceIdCandidates } },
      select: { service_name: true, nameInHindi: true, service_id: true, dms: true },
    });

    // popup_data and enable_preview fetched via raw SQL so it works before Prisma client regeneration
    let popupData: string | null = null;
    let enablePreview: boolean = false;
    try {
      const popupRows = await this.prisma.$queryRawUnsafe<{ popup_data: string | null; enable_preview: boolean }[]>(
        `SELECT popup_data, enable_preview FROM m_service WHERE service_id = ANY($1::text[]) LIMIT 1`,
        serviceIdCandidates,
      );
      popupData = popupRows[0]?.popup_data ?? null;
      enablePreview = popupRows[0]?.enable_preview ?? false;
    } catch { /* column may not exist yet */ }

    const pages = await this.prisma.formPageMaster.findMany({
      where: { service_id: { in: serviceIdCandidates }, form_id: formTypeId, is_active: YnFlag.Y },
      orderBy: { preference: 'asc' }
    });
    const pageIds = pages.map(p => p.id);

    const pageCats = await this.prisma.formPageCategoryMapping.findMany({
      where: { page_id: { in: pageIds }, is_active: YnFlag.Y },
      orderBy: [{ page_id: 'asc' }, { preference: 'asc' }]
    });
    const catIds = [...new Set(pageCats.map(c => c.category_id))];
    const cats = await this.prisma.formCategory.findMany({ where: { id: { in: catIds } } });
    const catMap = new Map(
      cats.map((c: any) => [
        c.id,
        normalizedLocale === 'hi'
          ? (c.nameInHindi || c.categoryName || c.nameAlt || 'Category')
          : (c.categoryName || c.nameAlt || 'Category'),
      ]),
    );

    const fields = await this.prisma.formBuilderField.findMany({
      where: { service_id: { in: serviceIdCandidates }, form_id: formTypeId, is_active: YnFlag.Y },
      orderBy: [{ page_id: 'asc' }, { category_id: 'asc' }, { preference: 'asc' }],
      include: { formField: true, optionConfig: true }
    });

    const addMoreGroups = await this.prisma.formAddMoreGroup.findMany({
      where: { service_id: { in: serviceIdCandidates }, form_id: formTypeId, is_active: YnFlag.Y },
      include: { columns: { orderBy: { col_order: 'asc' }, include: { builderField: { include: { formField: true, optionConfig: true } } } } }
    });

    let repeatablePages: any[] = [];
    try {
      repeatablePages = await this.prisma.formRepeatablePage.findMany({
        where: { service_id: { in: serviceIdCandidates }, form_id: formTypeId, page_id: { in: pageIds }, is_active: YnFlag.Y },
        include: { categories: { orderBy: { display_order: 'asc' } } }
      });
    } catch (error: any) {
      if (error?.code !== 'P2021') {
        throw error;
      }
      this.logger.warn('Repeatable page tables are missing; continuing without repeatable page configuration.');
    }

    const repeatablePageMap = new Map<number, any>();
    const repeatableCategoriesByPage = new Map<number, Set<number>>();
    repeatablePages.forEach((rp) => {
      repeatablePageMap.set(rp.trigger_builder_field_id, rp);
      const catSet = repeatableCategoriesByPage.get(rp.page_id) || new Set<number>();
      rp.categories.forEach((rc: any) => catSet.add(rc.category_id));
      repeatableCategoriesByPage.set(rp.page_id, catSet);
    });

    // Map field IDs to their field codes for parent field lookups
    const fieldIdToCode = new Map<number, string>();
    fields.forEach((f: any) => {
      fieldIdToCode.set(f.id, f.formField?.formCheckId || String(f.id));
    });

    const buildFieldOutput = async (f: any) => {
      let options: any = [];
      let masterCode: string | null = null;
      let parentFieldCode: string | null = null;

      if (f.optionConfig) {
        if (f.optionConfig.source_type === OptionSourceType.STATIC && f.optionConfig.static_options) {
          try {
            const parsedOpts = typeof f.optionConfig.static_options === 'string'
              ? JSON.parse(f.optionConfig.static_options)
              : f.optionConfig.static_options;

            options = Array.isArray(parsedOpts) ? parsedOpts.map((o: any) => ({
              label: o.label || o.name || String(o.value),
              value: String(o.value),
            })) : [];
          } catch {
            options = [];
          }
        } else if (f.optionConfig.source_type === OptionSourceType.MASTER && f.optionConfig.master_table_id) {
          if (!f.optionConfig.parent_builder_field_id) {
            options = await this.loadMasterOptions(f.optionConfig.master_table_id);
          }
          masterCode = f.optionConfig.master_table_id ? String(f.optionConfig.master_table_id) : null;
          parentFieldCode = f.optionConfig.parent_builder_field_id ? fieldIdToCode.get(Number(f.optionConfig.parent_builder_field_id)) ?? null : null;
        }
      }

      return {
        id: f.id,
        field_code: f.formField?.formCheckId,
        label: this.resolveFieldLabel(
          normalizedLocale,
          f.custom_label,
          f.formField?.name,
          f.formField?.nameInHindi,
          f.component_props,
        ),
        help_text: this.pickLocalizedText(
          f.component_props,
          'help_text',
          normalizedLocale,
          f.help_text,
        ),
        input_type: f.input_type,
        placeholder: this.pickLocalizedText(
          f.component_props,
          'placeholder',
          normalizedLocale,
          f.placeholder,
        ),
        is_required: f.is_required,
        is_readonly: f.is_readonly,
        grid_span: f.gridSpan,
        validation_rule: f.validation_rule,
        component_props: f.component_props,
        options,
        option_config: f.optionConfig ? {
          source_type: f.optionConfig.source_type,
          master_table_id: f.optionConfig.master_table_id,
          parent_builder_field_id: f.optionConfig.parent_builder_field_id,
        } : null,
        master_code: masterCode,
        parent_field_code: parentFieldCode,
      };
    };

    const rules = await this.prisma.formRule.findMany({
      where: {
        service_id: { in: serviceIdCandidates },
        form_id: formTypeId,
        is_active: YnFlag.Y,
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        scope: true,
        when_json: true,
        then_json: true,
        is_active: true,
      },
    });

    const pagesOut: any[] = [];
    for (const p of pages) {
      const pCats = pageCats.filter(pc => pc.page_id === p.id);
      const catsOut: any[] = [];

      const excludedCategories = repeatableCategoriesByPage.get(p.id) || new Set<number>();
      for (const pc of pCats) {
        if (excludedCategories.has(pc.category_id)) {
          continue;
        }

        const cFields = fields.filter(f => f.page_id === p.id && f.category_id === pc.category_id);
        const fieldsOut: any[] = [];

        for (const f of cFields) {
          const amGroups = await Promise.all(
            addMoreGroups
              .filter(g => g.trigger_builder_field_id === f.id)
              .map(async (g) => ({
                id: g.id,
                label: g.label,
                min_rows: g.min_rows,
                max_rows: g.max_rows,
                columns: await Promise.all(g.columns.map(async (col) => {
                  const bf = col.builderField;

                  let colOptions: any[] = [];
                  let colMasterCode: string | null = null;
                  let colParentFieldCode: string | null = null;

                  if (bf?.optionConfig) {
                    if (bf.optionConfig.source_type === OptionSourceType.STATIC && bf.optionConfig.static_options) {
                      try {
                        const parsed = typeof bf.optionConfig.static_options === 'string'
                          ? JSON.parse(bf.optionConfig.static_options)
                          : bf.optionConfig.static_options;
                        colOptions = Array.isArray(parsed)
                          ? parsed.map((o: any) => ({
                            label: o.label || o.name || String(o.value),
                            value: String(o.value),
                          }))
                          : [];
                      } catch { colOptions = []; }
                    } else if (bf.optionConfig.source_type === OptionSourceType.MASTER && bf.optionConfig.master_table_id) {
                      if (!bf.optionConfig.parent_builder_field_id) {
                        colOptions = await this.loadMasterOptions(bf.optionConfig.master_table_id);
                      }
                    }
                  }

                  return {
                    id: col.id,
                    builder_field_id: bf?.id,
                    field_code: bf?.formField?.formCheckId,
                    label: this.resolveFieldLabel(
                      normalizedLocale,
                      bf?.custom_label,
                      bf?.formField?.name,
                      bf?.formField?.nameInHindi,
                      bf?.component_props,
                    ),
                    input_type: bf?.input_type,
                    placeholder: this.pickLocalizedText(
                      bf?.component_props,
                      'placeholder',
                      normalizedLocale,
                      bf?.placeholder,
                    ),
                    is_required: bf?.is_required,
                    is_readonly: bf?.is_readonly,
                    grid_span: bf?.gridSpan,
                    validation_rule: bf?.validation_rule,
                    component_props: bf?.component_props,
                    options: colOptions,
                    option_config: bf?.optionConfig ? {
                      source_type: bf.optionConfig.source_type,
                      master_table_id: bf.optionConfig.master_table_id,
                      parent_builder_field_id: bf.optionConfig.parent_builder_field_id,
                    } : null,
                    master_code: colMasterCode,
                    parent_field_code: colParentFieldCode,
                  };
                })),
              }))
          );

          const baseField = await buildFieldOutput(f);
          const repeatablePage = repeatablePageMap.get(f.id);
          let repeatableConfig: any = null;
          if (repeatablePage) {
            const nestedCategories = await Promise.all(repeatablePage.categories.map(async (rc: any) => {
              // Allow nested fields to be pulled from the selected category regardless of which page
              // they were originally defined on — this ensures admin-selected categories render
              // inside the repeatable section even when they live on a different page.
              const nestedFields = fields
                .filter(nf => nf.category_id === rc.category_id && nf.input_type !== 'repeatable_page');
              const nestedFieldsOut = await Promise.all(nestedFields.map(async (nf) => buildFieldOutput(nf)));
              return {
                id: rc.category_id,
                name: catMap.get(rc.category_id),
                fields: nestedFieldsOut,
              };
            }));
            repeatableConfig = {
              id: repeatablePage.id,
              label: repeatablePage.label,
              min_rows: repeatablePage.min_rows,
              max_rows: repeatablePage.max_rows,
              min_rows_formula: repeatablePage.min_rows_formula,
              max_rows_formula: repeatablePage.max_rows_formula,
              categories: nestedCategories,
            };
          }

          fieldsOut.push({
            ...baseField,
            add_more_groups: amGroups,
            repeatable_page_config: repeatableConfig,
          });
        }
        catsOut.push({ id: pc.category_id, name: catMap.get(pc.category_id), fields: fieldsOut });
      }
      const pageName =
        normalizedLocale === 'hi'
          ? ((p as any).name_in_hindi || p.page_name)
          : p.page_name;
      pagesOut.push({ id: p.id, name: pageName, categories: catsOut });
    }

    return {
      serviceId,
      formTypeId,
      serviceName: service
        ? this.resolveServiceNameByLocale(normalizedLocale, service as any)
        : null,
      formName: mapping.form_name,
      dms: service?.dms ? (typeof service.dms === 'string' ? JSON.parse(service.dms) : service.dms) : null,
      popupData: popupData || null,
      enable_preview: enablePreview,
      pages: pagesOut,
      rules,
    };
  }

  // ── Hardcoded fallback labels for known appointment fields (service 968.0) ──
  private static readonly APPOINTMENT_FIELD_FALLBACKS: Record<string, string> = {
    'UK-FCL-04060_0': 'Appointment Date & Time',
    'UK-FCL-04274_0': 'Follow-up Date & Time',
    'UK-FCL-04275_0': 'Appointment Venue',
  };

  // Keys to always exclude from appointment display
  private static readonly APPOINTMENT_EXCLUDE_KEYS = new Set([
    '_paymentDemand', 'PaymentDemand', 'officer_comment',
    'UK-FCL-04270_0', // officer remark/comment field
    'UK-FCL-04273_0', // supportive document upload path
  ]);

  /**
   * Fetch appointment details from the CHALLAN workflow audit trail.
   * Resolves raw field codes → human-readable labels using formBuilderField,
   * with hardcoded fallbacks for known service 968.0 fields.
   */
  private async getAppointmentInfo(submissionId: number): Promise<{
    hasAppointment: boolean;
    fields: Record<string, string>;
    summary: string | null;
  }> {
    const empty = { hasAppointment: false, fields: {}, summary: null };

    // Find the submission to get serviceId
    const submission = await this.prisma.applicationSubmission.findUnique({
      where: { submissionId },
      select: { serviceId: true },
    });
    if (!submission) return empty;

    // Fetch latest CHALLAN audit entry for this application
    const challanAudit = await this.prisma.tWorkflowAudit.findFirst({
      where: {
        forwardLevel: { applicationId: BigInt(submissionId) },
        actionCode: 'CHALLAN',
      },
      orderBy: { createdAt: 'desc' },
      select: { payload: true },
    });

    if (!challanAudit?.payload) return empty;

    const rawPayload = (challanAudit.payload || {}) as Record<string, any>;
    const fieldCodes = Object.keys(rawPayload).filter(k =>
      k &&
      !InvestorServicesService.APPOINTMENT_EXCLUDE_KEYS.has(k) &&
      !k.startsWith('_') &&
      typeof rawPayload[k] !== 'object' // exclude objects like PaymentDemand, file uploads
    );
    if (fieldCodes.length === 0) return empty;

    // Resolve field codes to labels via formBuilderField
    let labelMap: Record<string, string> = {};
    try {
      const builderFields = await this.prisma.formBuilderField.findMany({
        where: {
          service_id: submission.serviceId,
          formField: { formCheckId: { in: fieldCodes } },
        },
        select: {
          custom_label: true,
          formField: { select: { formCheckId: true, name: true } },
        },
      });
      for (const bf of builderFields) {
        const code = (bf.formField as any)?.formCheckId;
        if (code) labelMap[code] = bf.custom_label || (bf.formField as any)?.name || code;
      }
    } catch { /* ignore resolution failures */ }

    // Build resolved fields with fallback labels — only include known appointment fields first
    const resolvedFields: Record<string, string> = {};
    // Prioritize known appointment fields for consistent ordering
    for (const knownCode of Object.keys(InvestorServicesService.APPOINTMENT_FIELD_FALLBACKS)) {
      const value = rawPayload[knownCode];
      if (value !== null && value !== undefined && value !== '' && typeof value === 'string') {
        const label = labelMap[knownCode]
          || InvestorServicesService.APPOINTMENT_FIELD_FALLBACKS[knownCode]
          || knownCode;
        resolvedFields[label] = value;
      }
    }

    // Then add any remaining non-excluded fields
    for (const [key, value] of Object.entries(rawPayload)) {
      if (InvestorServicesService.APPOINTMENT_EXCLUDE_KEYS.has(key)) continue;
      if (key.startsWith('_')) continue;
      if (value === null || value === undefined || value === '') continue;
      if (typeof value === 'object') continue; // skip objects
      if (Object.keys(InvestorServicesService.APPOINTMENT_FIELD_FALLBACKS).includes(key)) continue; // already added
      const label = labelMap[key] || key;
      resolvedFields[label] = String(value);
    }

    if (Object.keys(resolvedFields).length === 0) return empty;

    // Build a short summary from appointment date/venue
    const parts: string[] = [];
    const dateVal = rawPayload['UK-FCL-04060_0'];
    const venueVal = rawPayload['UK-FCL-04275_0'];
    if (dateVal) parts.push(dateVal);
    if (venueVal) parts.push(venueVal);
    const summary = parts.length > 0 ? `Appointment: ${parts.join(' | ')}` : null;

    return { hasAppointment: true, fields: resolvedFields, summary };
  }

  async getUserSubmissions(userId: number) {
    if (!userId || isNaN(userId)) return [];

    const submissions = await this.prisma.applicationSubmission.findMany({
      where: { userId: BigInt(userId) },
      orderBy: { applicationCreatedDate: 'desc' },
      select: {
        submissionId: true,
        serviceId: true,
        formId: true,
        applicationStatus: true,
        applicationCreatedDate: true,
      }
    });

    if (submissions.length === 0) return [];

    const serviceIds = [...new Set(submissions.map(s => s.serviceId))];
    const appIds = submissions.map(s => Number(s.submissionId));
    const [services, actionMasters, pendingPayments] = await Promise.all([
      this.prisma.service.findMany({
        where: { service_id: { in: serviceIds } },
        select: { service_id: true, service_name: true },
      }),
      this.prisma.workflowActionMaster.findMany({
        select: { code: true, name: true },
      }),
      this.prisma.paymentDetail.findMany({
        where: { applicationId: { in: appIds }, statusCode: 'P' },
        select: { applicationId: true }
      }),
    ]);

    // Fetch booked/accepted/reschedule-requested appointments from t_appointments
    const appointments = await this.prisma.appointment.findMany({
      where: {
        submissionId: { in: appIds.map(id => BigInt(id)) },
        status: { in: ['BOOKED', 'ACCEPTED', 'RESCHEDULE_REQUESTED'] },
      },
      orderBy: { bookedAt: 'desc' },
      select: {
        id: true,
        submissionId: true,
        serviceId: true,
        processCode: true,
        appointmentDate: true,
        startTime: true,
        endTime: true,
        venue: true,
        remarks: true,
        status: true,
      },
    });

    // Build appointment data map: submissionId → appointment details
    const appointmentDataMap = new Map<number, any>();
    for (const appt of appointments) {
      const sid = Number(appt.submissionId);
      if (appointmentDataMap.has(sid)) continue; // keep latest only
      appointmentDataMap.set(sid, {
        id: appt.id,
        appointmentDate: appt.appointmentDate?.toISOString?.()?.split('T')[0] || '',
        startTime: appt.startTime,
        endTime: appt.endTime,
        venue: appt.venue || null,
        remarks: appt.remarks || null,
        status: appt.status,
        popupMessage: null, // will be filled below
      });
    }

    // Fetch popupMessage from workflow configs for relevant services
    const appointmentServiceIds = [...new Set(appointments.map(a => a.serviceId))];
    if (appointmentServiceIds.length > 0) {
      const wfConfigs = await this.prisma.workflowConfiguration.findMany({
        where: {
          serviceId: { in: appointmentServiceIds },
          status: 'PUBLISHED',
        },
        select: { serviceId: true, configuration: true },
      });
      const popupMessageMap = new Map<string, string>();
      for (const wf of wfConfigs) {
        const config = wf.configuration as any;
        const processes = config?.processes || [];
        for (const proc of processes) {
          if (proc.requiresAppointment && proc.appointmentConfig?.popupMessage) {
            if (wf.serviceId) popupMessageMap.set(wf.serviceId, proc.appointmentConfig.popupMessage);
            break;
          }
        }
      }
      // Inject popupMessage into appointment data
      for (const appt of appointments) {
        const sid = Number(appt.submissionId);
        const data = appointmentDataMap.get(sid);
        if (data && !data.popupMessage && appt.serviceId) {
          data.popupMessage = popupMessageMap.get(appt.serviceId) || null;
        }
      }
    }

    const serviceMap = new Map(
      services.map((s) => [
        s.service_id,
        this.resolveServiceNameByLocale(
          'en',
          { service_name: s.service_name, nameInHindi: null },
        ),
      ]),
    );
    const actionLabelMap = new Map(actionMasters.map(a => [a.code.toUpperCase(), a.name]));

    return submissions.map(sub => {
      const statusCode = String(sub.applicationStatus || '').toUpperCase();
      const hasPendingPayment = pendingPayments.some(p => p.applicationId === Number(sub.submissionId));
      const apptData = appointmentDataMap.get(Number(sub.submissionId)) || null;
      return {
        submissionId: sub.submissionId.toString(),
        serviceCode: sub.serviceId,
        serviceName: serviceMap.get(sub.serviceId) || 'Unknown Service',
        formId: sub.formId ?? null,
        status: statusCode,
        statusLabel: actionLabelMap.get(statusCode) || statusCode,
        submittedOn: sub.applicationCreatedDate,
        pendingPayment: hasPendingPayment,
        appointmentData: apptData,
      };
    });
  }

  async getSubmissionDetails(submissionId: number, userId: number) {
    if (!submissionId || !userId) throw new BadRequestException('Invalid IDs provided');

    const submission = await this.prisma.applicationSubmission.findFirst({
      where: {
        submissionId: submissionId,
        userId: BigInt(userId)
      }
    });

    if (!submission) throw new NotFoundException('Application submission not found');

    const [config, appointmentInfo] = await Promise.all([
      submission.formId ? this.getFormConfig(submission.serviceId, submission.formId) : null,
      this.getAppointmentInfo(submissionId),
    ]);

    return {
      submissionId: submission.submissionId.toString(),
      status: submission.applicationStatus,
      submittedOn: submission.applicationCreatedDate,
      formData: submission.fieldValue,
      config,
      appointmentInfo: appointmentInfo.hasAppointment ? appointmentInfo : null,
    };
  }
}
