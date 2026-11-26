/* Generated from openapi.json by pnpm openapi. */
export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["HealthController_check"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/auth/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StaffAuthController_session"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StaffAuthController_login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/auth/two-factor": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StaffAuthController_secondFactor"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/auth/two-factor/webauthn": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StaffAuthController_keyOptions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/auth/setup/totp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StaffAuthController_startSetup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/auth/setup/totp/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StaffAuthController_finishSetup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StaffAuthController_logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/auth/forgot-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StaffAuthController_forgot"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/auth/reset/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StaffAuthController_resetInfo"];
        put?: never;
        post: operations["StaffAuthController_reset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/auth/invitation/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StaffAuthController_invitationInfo"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/auth/invitation/{token}/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StaffAuthController_choosePassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/auth/invitation/{token}/totp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StaffAuthController_verifyTotp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/auth/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PartnerAuthController_session"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PartnerAuthController_login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/auth/two-factor": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PartnerAuthController_secondFactor"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/auth/two-factor/webauthn": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PartnerAuthController_keyOptions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/auth/setup/totp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PartnerAuthController_startSetup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/auth/setup/totp/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PartnerAuthController_finishSetup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PartnerAuthController_logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/auth/forgot-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PartnerAuthController_forgot"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/auth/reset/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PartnerAuthController_resetInfo"];
        put?: never;
        post: operations["PartnerAuthController_reset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/auth/invitation/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PartnerAuthController_invitationInfo"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/auth/invitation/{token}/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PartnerAuthController_choosePassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/auth/invitation/{token}/totp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PartnerAuthController_verifyTotp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/auth/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["PreferencesController_save"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/auth/proof": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProofController_needed"];
        put?: never;
        post: operations["ProofController_give"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/auth/proof/webauthn": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ProofController_keyOptions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/account": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AccountController_data"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/account/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["AccountController_saveProfile"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/account/absence": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["AccountController_saveAbsence"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/account/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["AccountController_savePreferences"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/account/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["AccountController_changePassword"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/account/two-factor/totp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AccountController_startTotp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/account/two-factor/totp/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AccountController_verifyTotp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/account/two-factor/webauthn": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AccountController_keyOptions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/account/two-factor/webauthn/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AccountController_verifyKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/account/two-factor": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["AccountController_disable"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/account/sessions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["AccountController_closeSession"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/account/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["AccountController_closeOthers"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["MembersController_list"];
        put?: never;
        post: operations["MembersController_invite"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/members/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["MembersController_cancelInvitation"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/members/{id}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MembersController_disable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/members/{id}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MembersController_enable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/members/{id}/role": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["MembersController_changeRole"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/members/{id}/extension": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["MembersController_setExtension"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/members/{id}/reset-link": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MembersController_sendResetLink"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/members/{id}/require-2fa": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MembersController_requireSecondFactor"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/members/{id}/reset-2fa": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MembersController_resetSecondFactor"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/members/{id}/unlock": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MembersController_unlock"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/delegations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DelegationsController_data"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/delegations/{kind}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["DelegationsController_set"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/support-tickets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SupportController_open"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NotificationsController_list"];
        put: operations["NotificationsController_mark"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/notifications/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NotificationsController_markRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/dashboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DashboardController_read"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/dashboard/priorities/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["DashboardController_mark"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/secrets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SecretsController_list"];
        put?: never;
        post: operations["SecretsController_save"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/secrets/{id}/rotate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SecretsController_renew"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/secrets/{id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SecretsController_revoke"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/secrets/{id}/keep": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SecretsController_keep"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/settings/{scope}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SettingsController_hub"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/settings/{scope}/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SettingsController_section"];
        put: operations["SettingsController_save"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/creditors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CreditorsController_list"];
        put?: never;
        post: operations["CreditorsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/creditors/choices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CreditorsController_choices"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/creditors/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CreditorsController_detail"];
        put: operations["CreditorsController_change"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/creditors/{id}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CreditorsController_file"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/creditors/{id}/amendments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CreditorsController_amend"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/creditors/{id}/bank-accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CreditorsController_replace"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/creditors/{id}/bank-accounts/{accountId}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CreditorsController_confirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/creditors/{id}/bank-accounts/{accountId}/reveal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CreditorsController_reveal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/cases/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CasesController_search"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/cases/choices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CasesController_choices"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/cases/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CasesController_check"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/cases/assign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CasesController_assign"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/cases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CasesController_open"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/cases/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CasesController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/cases/{id}/invoices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CasesController_addInvoices"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/cases/{id}/access-code": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CasesController_accessCode"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/cases/{id}/access-code/regenerate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CasesController_renewAccessCode"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/cases/{id}/coordinates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CasesController_addContact"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/cases/{id}/coordinates/{coordinateId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["CasesController_changeContact"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/cases/{id}/payments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PaymentsController_record"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/cases/{id}/payments/{paymentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["PaymentsController_change"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/payment-plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PlansController_list"];
        put?: never;
        post: operations["PlansController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/payment-plans/simulation/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PlansController_simulation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/payment-plans/requests/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["PlansController_decide"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/interest-rates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["InterestRatesController_list"];
        put: operations["InterestRatesController_save"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DocumentsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/documents/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DocumentsController_import"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/documents/{id}/share": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DocumentsController_share"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/documents/{id}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DocumentsController_file"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TemplatesController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/templates/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TemplatesController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/templates/{id}/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["TemplatesController_import"];
        delete: operations["TemplatesController_cancel"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/templates/{id}/import/undo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["TemplatesController_undo"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/templates/{id}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["TemplatesController_restore"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/templates/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["TemplatesController_submit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/templates/{id}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["TemplatesController_review"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/debtor/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DebtorController_session"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/debtor/access": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DebtorController_access"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/debtor/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DebtorController_logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/debtor/cases/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DebtorController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/debtor/links/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DebtorController_link"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/debtor/code-by-sms": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DebtorController_codeBySms"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/debtor/limited/payment": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DebtorController_limitedPayment"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/debtor/limited/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DebtorController_limitedMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/debtor/cases/{id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DebtorController_list"];
        put?: never;
        post: operations["DebtorController_write"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/debtor/cases/{id}/messages/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DebtorController_read"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/debtor/cases/{id}/requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DebtorController_request"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/debtor/attachments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DebtorController_attach"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/cases/{id}/portal-messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StaffPortalController_answer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/portal/dashboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PortalController_dashboard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/portal/cases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PortalController_cases"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/portal/cases/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PortalController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/portal/plans/{id}/decision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PortalController_decide"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/portal/claims": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PortalController_deposit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/portal/attachments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PortalController_attach"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/portal/imports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PortalController_readImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/partner/portal/imports/{id}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PortalController_confirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/shell": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ShellController_shell"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ShellController_search"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: never;
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    HealthController_check: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        status: "ok";
                    };
                };
            };
        };
    };
    StaffAuthController_session: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        userId: string;
                        firstName: string;
                        lastName: string;
                        /** Format: email */
                        email: string;
                        /** @enum {string} */
                        role: "DEVELOPER" | "DIRECTOR" | "COLLECTION_MANAGER" | "CLAIMS_OFFICER" | "CREDITOR";
                        activeDelegations: ("TECHNICAL" | "ADMINISTRATIVE")[];
                        directorName: string;
                        twoFactorEnabled: boolean;
                        extension: string | null;
                        preferences: {
                            /** @enum {string} */
                            theme: "light" | "dark" | "system";
                            /** @enum {string} */
                            density: "comfortable" | "compact";
                            lowVision: boolean;
                        };
                    };
                };
            };
        };
    };
    StaffAuthController_login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        status: "OK";
                        session: {
                            userId: string;
                            firstName: string;
                            lastName: string;
                            /** Format: email */
                            email: string;
                            /** @enum {string} */
                            role: "DEVELOPER" | "DIRECTOR" | "COLLECTION_MANAGER" | "CLAIMS_OFFICER" | "CREDITOR";
                            activeDelegations: ("TECHNICAL" | "ADMINISTRATIVE")[];
                            directorName: string;
                            twoFactorEnabled: boolean;
                            extension: string | null;
                            preferences: {
                                /** @enum {string} */
                                theme: "light" | "dark" | "system";
                                /** @enum {string} */
                                density: "comfortable" | "compact";
                                lowVision: boolean;
                            };
                        } | null;
                    } | {
                        /** @enum {string} */
                        status: "TWO_FACTOR";
                        methods: ("TOTP" | "WEBAUTHN")[];
                    } | {
                        /** @enum {string} */
                        status: "SETUP_REQUIRED";
                    } | {
                        /** @enum {string} */
                        status: "WRONG_PORTAL";
                        /** @enum {string} */
                        portal: "espace" | "partenaires";
                        url: string;
                    };
                };
            };
        };
    };
    StaffAuthController_secondFactor: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        status: "OK";
                        session: {
                            userId: string;
                            firstName: string;
                            lastName: string;
                            /** Format: email */
                            email: string;
                            /** @enum {string} */
                            role: "DEVELOPER" | "DIRECTOR" | "COLLECTION_MANAGER" | "CLAIMS_OFFICER" | "CREDITOR";
                            activeDelegations: ("TECHNICAL" | "ADMINISTRATIVE")[];
                            directorName: string;
                            twoFactorEnabled: boolean;
                            extension: string | null;
                            preferences: {
                                /** @enum {string} */
                                theme: "light" | "dark" | "system";
                                /** @enum {string} */
                                density: "comfortable" | "compact";
                                lowVision: boolean;
                            };
                        } | null;
                    } | {
                        /** @enum {string} */
                        status: "TWO_FACTOR";
                        methods: ("TOTP" | "WEBAUTHN")[];
                    } | {
                        /** @enum {string} */
                        status: "SETUP_REQUIRED";
                    } | {
                        /** @enum {string} */
                        status: "WRONG_PORTAL";
                        /** @enum {string} */
                        portal: "espace" | "partenaires";
                        url: string;
                    };
                };
            };
        };
    };
    StaffAuthController_keyOptions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        challenge: string;
                    } & {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
    StaffAuthController_startSetup: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        uri: string;
                        key: string;
                    };
                };
            };
        };
    };
    StaffAuthController_finishSetup: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        backupCodes: string[];
                        session: {
                            userId: string;
                            firstName: string;
                            lastName: string;
                            /** Format: email */
                            email: string;
                            /** @enum {string} */
                            role: "DEVELOPER" | "DIRECTOR" | "COLLECTION_MANAGER" | "CLAIMS_OFFICER" | "CREDITOR";
                            activeDelegations: ("TECHNICAL" | "ADMINISTRATIVE")[];
                            directorName: string;
                            twoFactorEnabled: boolean;
                            extension: string | null;
                            preferences: {
                                /** @enum {string} */
                                theme: "light" | "dark" | "system";
                                /** @enum {string} */
                                density: "comfortable" | "compact";
                                lowVision: boolean;
                            };
                        } | null;
                    };
                };
            };
        };
    };
    StaffAuthController_logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    StaffAuthController_forgot: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    StaffAuthController_resetInfo: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: email */
                        email: string;
                        firstName: string;
                        invitedBy?: string;
                        /** @enum {string} */
                        role?: "DEVELOPER" | "DIRECTOR" | "COLLECTION_MANAGER" | "CLAIMS_OFFICER" | "CREDITOR";
                        twoFactorRequired: boolean;
                    };
                };
            };
        };
    };
    StaffAuthController_reset: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    StaffAuthController_invitationInfo: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: email */
                        email: string;
                        firstName: string;
                        invitedBy?: string;
                        /** @enum {string} */
                        role?: "DEVELOPER" | "DIRECTOR" | "COLLECTION_MANAGER" | "CLAIMS_OFFICER" | "CREDITOR";
                        twoFactorRequired: boolean;
                    };
                };
            };
        };
    };
    StaffAuthController_choosePassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        totpKey: string;
                    };
                };
            };
        };
    };
    StaffAuthController_verifyTotp: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        backupCodes: string[];
                    };
                };
            };
        };
    };
    PartnerAuthController_session: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        userId: string;
                        firstName: string;
                        lastName: string;
                        /** Format: email */
                        email: string;
                        creditor: {
                            id: string;
                            name: string;
                            initials: string;
                            siren: string;
                        };
                        officer: string;
                        unread: number;
                    };
                };
            };
        };
    };
    PartnerAuthController_login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        status: "OK";
                        session: {
                            userId: string;
                            firstName: string;
                            lastName: string;
                            /** Format: email */
                            email: string;
                            /** @enum {string} */
                            role: "DEVELOPER" | "DIRECTOR" | "COLLECTION_MANAGER" | "CLAIMS_OFFICER" | "CREDITOR";
                            activeDelegations: ("TECHNICAL" | "ADMINISTRATIVE")[];
                            directorName: string;
                            twoFactorEnabled: boolean;
                            extension: string | null;
                            preferences: {
                                /** @enum {string} */
                                theme: "light" | "dark" | "system";
                                /** @enum {string} */
                                density: "comfortable" | "compact";
                                lowVision: boolean;
                            };
                        } | null;
                    } | {
                        /** @enum {string} */
                        status: "TWO_FACTOR";
                        methods: ("TOTP" | "WEBAUTHN")[];
                    } | {
                        /** @enum {string} */
                        status: "SETUP_REQUIRED";
                    } | {
                        /** @enum {string} */
                        status: "WRONG_PORTAL";
                        /** @enum {string} */
                        portal: "espace" | "partenaires";
                        url: string;
                    };
                };
            };
        };
    };
    PartnerAuthController_secondFactor: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        status: "OK";
                        session: {
                            userId: string;
                            firstName: string;
                            lastName: string;
                            /** Format: email */
                            email: string;
                            /** @enum {string} */
                            role: "DEVELOPER" | "DIRECTOR" | "COLLECTION_MANAGER" | "CLAIMS_OFFICER" | "CREDITOR";
                            activeDelegations: ("TECHNICAL" | "ADMINISTRATIVE")[];
                            directorName: string;
                            twoFactorEnabled: boolean;
                            extension: string | null;
                            preferences: {
                                /** @enum {string} */
                                theme: "light" | "dark" | "system";
                                /** @enum {string} */
                                density: "comfortable" | "compact";
                                lowVision: boolean;
                            };
                        } | null;
                    } | {
                        /** @enum {string} */
                        status: "TWO_FACTOR";
                        methods: ("TOTP" | "WEBAUTHN")[];
                    } | {
                        /** @enum {string} */
                        status: "SETUP_REQUIRED";
                    } | {
                        /** @enum {string} */
                        status: "WRONG_PORTAL";
                        /** @enum {string} */
                        portal: "espace" | "partenaires";
                        url: string;
                    };
                };
            };
        };
    };
    PartnerAuthController_keyOptions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        challenge: string;
                    } & {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
    PartnerAuthController_startSetup: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        uri: string;
                        key: string;
                    };
                };
            };
        };
    };
    PartnerAuthController_finishSetup: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        backupCodes: string[];
                        session: {
                            userId: string;
                            firstName: string;
                            lastName: string;
                            /** Format: email */
                            email: string;
                            /** @enum {string} */
                            role: "DEVELOPER" | "DIRECTOR" | "COLLECTION_MANAGER" | "CLAIMS_OFFICER" | "CREDITOR";
                            activeDelegations: ("TECHNICAL" | "ADMINISTRATIVE")[];
                            directorName: string;
                            twoFactorEnabled: boolean;
                            extension: string | null;
                            preferences: {
                                /** @enum {string} */
                                theme: "light" | "dark" | "system";
                                /** @enum {string} */
                                density: "comfortable" | "compact";
                                lowVision: boolean;
                            };
                        } | null;
                    };
                };
            };
        };
    };
    PartnerAuthController_logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    PartnerAuthController_forgot: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    PartnerAuthController_resetInfo: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: email */
                        email: string;
                        firstName: string;
                        invitedBy?: string;
                        /** @enum {string} */
                        role?: "DEVELOPER" | "DIRECTOR" | "COLLECTION_MANAGER" | "CLAIMS_OFFICER" | "CREDITOR";
                        twoFactorRequired: boolean;
                    };
                };
            };
        };
    };
    PartnerAuthController_reset: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    PartnerAuthController_invitationInfo: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: email */
                        email: string;
                        firstName: string;
                        invitedBy?: string;
                        /** @enum {string} */
                        role?: "DEVELOPER" | "DIRECTOR" | "COLLECTION_MANAGER" | "CLAIMS_OFFICER" | "CREDITOR";
                        twoFactorRequired: boolean;
                    };
                };
            };
        };
    };
    PartnerAuthController_choosePassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        totpKey: string;
                    };
                };
            };
        };
    };
    PartnerAuthController_verifyTotp: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        backupCodes: string[];
                    };
                };
            };
        };
    };
    PreferencesController_save: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ProofController_needed: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        methods: ("PASSWORD" | "TOTP" | "WEBAUTHN")[];
                    };
                };
            };
        };
    };
    ProofController_give: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ProofController_keyOptions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        challenge: string;
                    } & {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
    AccountController_data: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        signature: string[];
                        absence: {
                            substituteId: string;
                            from: string;
                            to: string;
                            autoReply: boolean;
                        };
                        substitutes: {
                            id: string;
                            name: string;
                        }[];
                        passwordChangedOn: string;
                        twoFactor: {
                            enabled: boolean;
                            /** @enum {string|null} */
                            method: "TOTP" | "WEBAUTHN" | null;
                            mandatory: boolean;
                            since: string | null;
                        };
                        sessions: {
                            id: string;
                            device: string;
                            meta: string;
                            mobile: boolean;
                            current: boolean;
                        }[];
                        notifications: {
                            id: string;
                            label: string;
                            detail: string;
                            inApp: boolean;
                            email: boolean;
                        }[];
                        dailySummary: boolean;
                        quietHours: boolean;
                    };
                };
            };
        };
    };
    AccountController_saveProfile: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AccountController_saveAbsence: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AccountController_savePreferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AccountController_changePassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AccountController_startTotp: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        uri: string;
                        key: string;
                    };
                };
            };
        };
    };
    AccountController_verifyTotp: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        backupCodes: string[];
                    };
                };
            };
        };
    };
    AccountController_keyOptions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        challenge: string;
                    } & {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
    AccountController_verifyKey: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        backupCodes: string[];
                    };
                };
            };
        };
    };
    AccountController_disable: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AccountController_closeSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AccountController_closeOthers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    MembersController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        members: {
                            id: string;
                            firstName: string;
                            lastName: string;
                            /** Format: email */
                            email: string;
                            /** @enum {string} */
                            role: "DEVELOPER" | "DIRECTOR" | "COLLECTION_MANAGER" | "CLAIMS_OFFICER" | "CREDITOR";
                            extension: string | null;
                            /** @enum {string} */
                            status: "ACTIVE" | "INVITED" | "DISABLED";
                            twoFactor: boolean;
                            cases: number;
                            lastSeen: string;
                            creditor: string | null;
                            sessions: number;
                            twoFactorRequired: boolean;
                            locked: boolean;
                            activity: {
                                what: string;
                                when: string;
                            }[];
                        }[];
                        canInvite: boolean;
                        canDisable: boolean;
                        canEditExtension: boolean;
                        canSupport: boolean;
                        creditors: {
                            id: string;
                            name: string;
                        }[];
                    };
                };
            };
        };
    };
    MembersController_invite: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    MembersController_cancelInvitation: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    MembersController_disable: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    MembersController_enable: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    MembersController_changeRole: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    MembersController_setExtension: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    MembersController_sendResetLink: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    MembersController_requireSecondFactor: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    MembersController_resetSecondFactor: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    MembersController_unlock: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DelegationsController_data: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        technical: boolean;
                        administrative: boolean;
                        developer: string;
                        manager: string;
                    };
                };
            };
        };
    };
    DelegationsController_set: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SupportController_open: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        number: string;
                    };
                };
            };
        };
    };
    NotificationsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        /** @enum {string} */
                        kind: "PAYMENT" | "MESSAGE" | "REMINDER" | "LITIGATION" | "CREDITOR" | "SYSTEM";
                        unread: boolean;
                        /** @enum {string} */
                        day: "TODAY" | "YESTERDAY" | "EARLIER";
                        time: string;
                        text: string;
                        meta: string;
                        href: string;
                        cta: string;
                    }[];
                };
            };
        };
    };
    NotificationsController_mark: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    NotificationsController_markRead: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DashboardController_read: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        scope: "GLOBAL" | "TEAM" | "PERSONAL";
                        /** Format: date */
                        date: string;
                        outstanding: number;
                        debtors: number;
                        invoices: number;
                        overdue30: number;
                        overdue30Sub: string;
                        periods: {
                            week: {
                                note: string;
                                recovered: number;
                                recoveredSub: string;
                                targetRatio: number | null;
                            };
                            month: {
                                note: string;
                                recovered: number;
                                recoveredSub: string;
                                targetRatio: number | null;
                            };
                            year: {
                                note: string;
                                recovered: number;
                                recoveredSub: string;
                                targetRatio: number | null;
                            };
                        };
                        invoicesRecovered: number;
                        invoicesEntrusted: number;
                        dsoDays: number;
                        dsoSub: string;
                        priorities: {
                            id: string;
                            title: string;
                            meta: string;
                            tag: string;
                            /** @enum {string} */
                            tone: "OVERDUE" | "PROMISE" | "REMINDER" | "DISPUTE" | "SETTLED" | "PLAN" | "FORMAL_NOTICE" | "LITIGATION" | "NEW" | "LOST";
                            /** @enum {string} */
                            icon: "phone" | "euro" | "check" | "mail" | "alert" | "scale";
                            href: string;
                            cta: string;
                            done: boolean;
                        }[];
                        feed: {
                            id: string;
                            /** @enum {string} */
                            kind: "PAYMENT" | "CALL" | "MESSAGE" | "APPROVAL" | "ALERT" | "SYSTEM";
                            text: string;
                            meta: string;
                            time: string;
                        }[];
                        monthlyTarget: number;
                        months: {
                            label: string;
                            amount: number;
                        }[];
                        aging: {
                            label: string;
                            amount: number;
                            percent: number;
                        }[];
                        creditors: {
                            id: string;
                            name: string;
                            siren: string;
                            sector: string;
                            debtors: number;
                            invoices: number;
                            outstanding: number;
                            recovered: number;
                            rate: number;
                        }[];
                        topDebtors: {
                            id: string;
                            name: string;
                            siret: string;
                            creditor: string;
                            amount: number;
                            daysLate: number;
                            /** @enum {string} */
                            status: "OVERDUE" | "PROMISE" | "REMINDER" | "DISPUTE" | "SETTLED" | "PLAN" | "FORMAL_NOTICE" | "LITIGATION" | "NEW" | "LOST";
                            statusLabel: string;
                        }[];
                        team: {
                            id: string;
                            name: string;
                            /** @enum {string} */
                            presence: "available" | "call" | "pause" | "away";
                            calls: number | null;
                            target: number;
                        }[];
                    };
                };
            };
        };
    };
    DashboardController_mark: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SecretsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            id: string;
                            /** @enum {string} */
                            name: "RESEND_API_KEY" | "RESEND_ACCOUNT_API_KEY" | "RESEND_WEBHOOK_SECRET" | "MYSENDINGBOX_API_KEY" | "MYSENDINGBOX_TEST_API_KEY" | "SCW_ACCESS_KEY" | "SCW_SECRET_KEY" | "OVH_API_APP_KEY" | "OVH_API_APP_SECRET" | "OVH_API_CONSUMER_KEY" | "OVH_SMS_APP_KEY" | "OVH_SMS_APP_SECRET" | "OVH_SMS_CONSUMER_KEY" | "OVH_SMS_SERVICE_NAME" | "COLLECTION_MAILBOX_PASSWORD" | "TCX_API_CLIENT_ID" | "TCX_API_CLIENT_SECRET" | "AI_API_KEY" | "MAILBOX_SECRETS_KEY" | "ACCESS_CODE_KEY" | "LOOKUP_KEY";
                            internal: boolean;
                            service: string;
                            environment: string;
                            used: string;
                            rotated: string;
                            /** @enum {string} */
                            status: "VALID" | "EXPIRING" | "REVOKE_PENDING" | "REVOKED";
                        }[];
                    };
                };
            };
        };
    };
    SecretsController_save: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SecretsController_renew: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SecretsController_revoke: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SecretsController_keep: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SettingsController_hub: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        canEdit: boolean;
                        groups: {
                            label: string;
                            tiles: {
                                id: string;
                                title: string;
                                description: string;
                                icon: string;
                                status: string;
                                /** @enum {string} */
                                statusTone: "neutral" | "info" | "success" | "warning" | "danger" | "teal" | "violet" | "marine" | "or";
                            }[];
                        }[];
                    };
                };
            };
        };
    };
    SettingsController_section: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        version: number;
                        canEdit: boolean;
                        blocks: {
                            id: string;
                            title: string;
                            description: string;
                            fields: {
                                id: string;
                                /** @enum {string} */
                                kind: "text" | "select" | "switch" | "value";
                                label: string;
                                description: string;
                                value: string;
                                checked: boolean;
                                options: string[];
                                locked: boolean;
                                status: string | null;
                                /** @enum {string} */
                                statusTone: "neutral" | "info" | "success" | "warning" | "danger" | "teal" | "violet" | "marine" | "or";
                            }[];
                        }[];
                        tables: {
                            id: string;
                            title: string;
                            description: string;
                            columns: string[];
                            rows: (string | {
                                text: string;
                                /** @enum {string} */
                                tone: "neutral" | "info" | "success" | "warning" | "danger" | "teal" | "violet" | "marine" | "or";
                            })[][];
                        }[];
                        notes: string[];
                    };
                };
            };
        };
    };
    SettingsController_save: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    CreditorsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        initials: string;
                        name: string;
                        sector: string;
                        siren: string;
                        debtors: number;
                        invoices: number;
                        outstanding: number;
                        recovered: number;
                        rate: number;
                        fee: string;
                        owner: string;
                        /** @enum {string} */
                        status: "ACTIVE" | "RENEWAL";
                        statusLabel: string;
                    }[];
                };
            };
        };
    };
    CreditorsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                    };
                };
            };
        };
    };
    CreditorsController_choices: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        managers: {
                            id: string;
                            name: string;
                        }[];
                        /** @enum {string} */
                        bankAccess: "EDIT" | "NONE";
                        defaults: {
                            amicableRateBp: number;
                        };
                    };
                };
            };
        };
    };
    CreditorsController_detail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        initials: string;
                        name: string;
                        sector: string;
                        siren: string;
                        debtors: number;
                        invoices: number;
                        outstanding: number;
                        recovered: number;
                        rate: number;
                        fee: string;
                        owner: string;
                        /** @enum {string} */
                        status: "ACTIVE" | "RENEWAL";
                        statusLabel: string;
                        /** Format: date */
                        mandateSince: string;
                        ownerName: string;
                        totalDebtors: number;
                        portfolio: {
                            id: string;
                            name: string;
                            reference: string;
                            amount: number;
                            daysLate: number;
                            /** @enum {string} */
                            status: "OVERDUE" | "PROMISE" | "REMINDER" | "DISPUTE" | "SETTLED" | "PLAN" | "FORMAL_NOTICE" | "LITIGATION" | "NEW" | "LOST";
                            statusLabel: string;
                            invoices: {
                                number: string;
                                externalRef: string;
                                /** Format: date */
                                due: string;
                                total: number;
                                left: number;
                                /** @enum {string} */
                                state: "UNPAID" | "PARTIAL" | "DISPUTED" | "REMINDED" | "PLAN";
                            }[];
                        }[];
                        payouts: {
                            id: string;
                            /** Format: date */
                            date: string;
                            collections: number;
                            gross: number;
                            fee: number;
                            net: number;
                        }[];
                        nextPayout: {
                            /** Format: date */
                            date: string;
                            net: number;
                            gross: number;
                            fee: number;
                        };
                        activity: {
                            id: string;
                            who: string;
                            what: string;
                            when: string;
                            /** @enum {string|null} */
                            status: "OVERDUE" | "PROMISE" | "REMINDER" | "DISPUTE" | "SETTLED" | "PLAN" | "FORMAL_NOTICE" | "LITIGATION" | "NEW" | "LOST" | null;
                        }[];
                        mandateTerms: {
                            label: string;
                            value: string;
                        }[];
                        contact: {
                            name: string;
                            title: string;
                            phone: string;
                            /** Format: email */
                            email: string;
                            portalEnabled: boolean;
                        };
                    };
                };
            };
        };
    };
    CreditorsController_change: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    CreditorsController_file: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        version: number;
                        siren: string;
                        identity: {
                            legalName: string;
                            name: string;
                            sector: string;
                            vatNumber: string;
                            address: string;
                            postalCode: string;
                            city: string;
                            managerId: string | null;
                            portalEnabled: boolean;
                        };
                        contacts: {
                            name: string;
                            title: string;
                            /** Format: email */
                            email: string;
                            phone: string;
                            isMain: boolean;
                        }[];
                        mandates: {
                            amicableRateBp: number;
                            litigationRateBp: number;
                            openingFeeCents: number;
                            planMonthsWithoutConsent: 3 | 6 | 12;
                            discountMaxBp: number;
                            litigationNeedsConsent: boolean;
                            deferSmallRemittances: boolean;
                            /** @enum {string} */
                            interestMode: "ECB_PLUS_TEN" | "CONTRACT" | "NONE";
                            contractRateBp: number | null;
                            fixedIndemnity: boolean;
                            reportingDay: number;
                            /** @enum {string} */
                            scenario: "BUSINESS" | "CONSUMER" | "KEY_ACCOUNTS";
                            /** Format: date */
                            startsOn: string;
                            /** Format: date */
                            endsOn: string | null;
                            id: string;
                            /** @enum {string} */
                            state: "CURRENT" | "TO_COME" | "ENDED";
                            hasContract: boolean;
                        }[];
                        openCases: number;
                        updatedBy: string | null;
                        updatedAt: string;
                        /** @enum {string} */
                        bankAccess: "EDIT" | "NONE";
                        bankAccount: {
                            id: string;
                            holder: string;
                            masked: string;
                            bic: string;
                            /** Format: date */
                            since: string;
                            confirmed: {
                                /** Format: date */
                                on: string;
                                with: string;
                            } | null;
                        } | null;
                    };
                };
            };
        };
    };
    CreditorsController_amend: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    CreditorsController_replace: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    CreditorsController_confirm: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    CreditorsController_reveal: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        iban: string;
                    };
                };
            };
        };
    };
    CasesController_search: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            id: string;
                            reference: string;
                            name: string;
                            identifier: string;
                            creditorId: string;
                            creditor: string;
                            invoicesLabel: string;
                            amount: number;
                            daysLate: number | null;
                            /** @enum {string} */
                            status: "OVERDUE" | "PROMISE" | "REMINDER" | "DISPUTE" | "SETTLED" | "PLAN" | "FORMAL_NOTICE" | "LITIGATION" | "NEW" | "LOST";
                            statusLabel: string;
                            nextAction: string;
                            nextDate: string;
                            officerId: string | null;
                            officer: string | null;
                            canAct: boolean;
                        }[];
                        total: number;
                        counts: {
                            [key: string]: number;
                        };
                        stats: {
                            outstanding: number;
                            invoices: number;
                            overdue: number;
                            overdueAmount: number;
                            promises: number;
                            promisesToday: number;
                            recovered: number;
                            targetRatio: number | null;
                        };
                    };
                };
            };
        };
    };
    CasesController_choices: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        creditors: {
                            id: string;
                            name: string;
                        }[];
                        officers: {
                            id: string;
                            name: string;
                        }[];
                        mayAssign: boolean;
                    };
                };
            };
        };
    };
    CasesController_check: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        mandate: {
                            id: string;
                            /** Format: date */
                            since: string;
                            /** @enum {string} */
                            scenario: "BUSINESS" | "CONSUMER" | "KEY_ACCOUNTS";
                            fixedIndemnity: boolean;
                            terms: {
                                label: string;
                                value: string;
                            }[];
                            hasContract: boolean;
                        } | null;
                        known: {
                            name: string;
                            /** @enum {string} */
                            kind: "COMPANY" | "SOLE_TRADER" | "INDIVIDUAL";
                        } | null;
                        /** Format: date */
                        startsOn: string | null;
                        open: {
                            id: string;
                            reference: string;
                            name: string;
                            version: number;
                            officer: string | null;
                            canAct: boolean;
                        } | null;
                        others: {
                            creditor: string;
                            invoices: number;
                        }[];
                    };
                };
            };
        };
    };
    CasesController_assign: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    CasesController_open: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        reference: string;
                    };
                };
            };
        };
    };
    CasesController_detail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        reference: string;
                        name: string;
                        identifier: string;
                        creditorId: string;
                        creditor: string;
                        invoicesLabel: string;
                        amount: number;
                        daysLate: number | null;
                        /** @enum {string} */
                        status: "OVERDUE" | "PROMISE" | "REMINDER" | "DISPUTE" | "SETTLED" | "PLAN" | "FORMAL_NOTICE" | "LITIGATION" | "NEW" | "LOST";
                        statusLabel: string;
                        nextAction: string;
                        nextDate: string;
                        officerId: string | null;
                        officer: string | null;
                        canAct: boolean;
                        creditorRef: string;
                        isIndividual: boolean;
                        principal: number;
                        interest: number;
                        fees: number;
                        remindersSent: number;
                        remindersTotal: number;
                        risk: {
                            label: string;
                            reason: string;
                        } | null;
                        contacts: {
                            id: string;
                            /** @enum {string} */
                            kind: "PHONE" | "EMAIL";
                            value: string;
                            verified: boolean;
                        }[];
                        mainContact: {
                            name: string;
                            title: string;
                            phone: string;
                            email: string;
                            address: string;
                        };
                        aiSummary: {
                            events: number;
                            updated: string;
                            lines: {
                                k: string;
                                v: string;
                            }[];
                        } | null;
                        invoices: {
                            number: string;
                            /** Format: date */
                            issued: string;
                            /** Format: date */
                            due: string;
                            amount: number;
                            daysLate: number;
                        }[];
                        history: {
                            id: string;
                            title: string;
                            detail: string;
                            date: string;
                            actor: string;
                            onBehalfOf: string | null;
                            /** @enum {string} */
                            tone: "danger" | "info" | "warning" | "success" | "neutral";
                        }[];
                        exchanges: {
                            id: string;
                            /** @enum {string} */
                            channel: "EMAIL_IN" | "EMAIL_OUT" | "CALL" | "SMS_IN" | "SMS_OUT" | "LETTER" | "REGISTERED_LETTER" | "PORTAL_IN" | "PORTAL_OUT";
                            title: string;
                            text: string;
                            when: string;
                            /** @enum {string|null} */
                            delivery: "SENT" | "DELIVERED" | "ACKNOWLEDGED" | "FAILED" | null;
                            acknowledgmentId: string | null;
                            verified: boolean;
                        }[];
                        payments: {
                            id: string;
                            /** @enum {string} */
                            method: "CHEQUE" | "TRANSFER";
                            amount: number;
                            /** @enum {string} */
                            status: "RECEIVED" | "DEPOSITED" | "CASHED" | "BOUNCED" | "RECONCILED" | "TO_RECONCILE";
                            /** Format: date */
                            receivedOn: string;
                            /** Format: date */
                            depositedOn: string | null;
                            chequeNumber: string | null;
                            bank: string | null;
                            label: string | null;
                            receiptId: string | null;
                            allocation: {
                                interest: number;
                                principal: number;
                                fees: number;
                            };
                            version: number;
                        }[];
                        documents: {
                            id: string;
                            name: string;
                            meta: string;
                            /** @enum {string} */
                            kind: "PDF" | "DOCX";
                        }[];
                        mandate: {
                            sector: string;
                            terms: {
                                label: string;
                                value: string;
                            }[];
                        };
                        otherClaims: {
                            creditor: string;
                            invoices: number;
                            amount: number;
                        }[];
                        scenario: {
                            label: string;
                            when: string;
                            /** @enum {string} */
                            state: "DONE" | "NEXT" | "TODO";
                        }[];
                        firstLetter: {
                            reference: string;
                            /** Format: date */
                            date: string;
                        } | null;
                        contactLimit: string | null;
                    };
                };
            };
        };
    };
    CasesController_addInvoices: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    CasesController_accessCode: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        code: string | null;
                        version: number;
                    };
                };
            };
        };
    };
    CasesController_renewAccessCode: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    CasesController_addContact: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    CasesController_changeContact: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    PaymentsController_record: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    PaymentsController_change: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    PlansController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        plans: {
                            id: string;
                            caseId: string;
                            debtor: string;
                            identifier: string;
                            creditorId: string;
                            creditor: string;
                            total: number;
                            /** @enum {string} */
                            state: "ON_TRACK" | "LATE" | "DEFAULT" | "WAITING_CREDITOR" | "WAITING_DEBTOR";
                            /** @enum {string} */
                            method: "CHEQUE" | "TRANSFER";
                            installments: {
                                number: number;
                                /** Format: date */
                                date: string;
                                amount: number;
                                /** @enum {string} */
                                state: "PAID" | "MISSED" | "UPCOMING";
                            }[];
                            canAct: boolean;
                        }[];
                        requests: {
                            id: string;
                            debtor: string;
                            creditor: string;
                            plan: string;
                            origin: string;
                            flag: string;
                            /** @enum {string} */
                            tone: "warning" | "info" | "danger";
                            /** @enum {string|null} */
                            decision: "APPROVED" | "REFUSED" | null;
                            version: number;
                        }[];
                        canValidate: boolean;
                        thresholdMonths: number;
                        stats: {
                            active: number;
                            remaining: number;
                            nextMonth: number;
                            nextMonthCount: number;
                            honored: number;
                            defaults: number;
                        };
                        simulation: {
                            caseId: string;
                            debtor: string;
                            creditor: string;
                            balance: number;
                            ownedByDirector: boolean;
                        } | null;
                    };
                };
            };
        };
    };
    PlansController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    PlansController_simulation: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        caseId: string;
                        debtor: string;
                        creditor: string;
                        balance: number;
                        ownedByDirector: boolean;
                    };
                };
            };
        };
    };
    PlansController_decide: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    InterestRatesController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            /** @enum {string} */
                            kind: "ECB" | "LEGAL_INDIVIDUAL";
                            /** Format: date */
                            validFrom: string;
                            rateBp: number;
                            enteredBy: string;
                            updatedAt: string;
                        }[];
                        canEdit: boolean;
                    };
                };
            };
        };
    };
    InterestRatesController_save: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DocumentsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            id: string;
                            /** @enum {string} */
                            category: "REMINDER_LETTER" | "FORMAL_NOTICE" | "PAYMENT_PLAN" | "INVOICE" | "EVIDENCE" | "COURT" | "REMITTANCE" | "RECEIPT";
                            name: string;
                            title: string;
                            debtor: string;
                            caseId: string | null;
                            creditor: string;
                            creditorId: string;
                            /** Format: date */
                            date: string;
                            size: string;
                            /** @enum {string} */
                            kind: "PDF" | "DOCX" | "PNG" | "JPEG";
                            status: string;
                            /** @enum {string} */
                            tone: "info" | "success" | "neutral" | "marine" | "warning";
                            tracking: string;
                            author: string;
                        }[];
                        total: number;
                        size: string;
                        counts: {
                            [key: string]: number;
                        };
                    };
                };
            };
        };
    };
    DocumentsController_import: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        /** @enum {string} */
                        status: "ATTACHED" | "TO_FILE";
                    };
                };
            };
        };
    };
    DocumentsController_share: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DocumentsController_file: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Le fichier, sous un nom neutre. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    TemplatesController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            id: string;
                            name: string;
                            channel: string;
                            /** @enum {string} */
                            category: "COLLECTION" | "BILLING";
                            date: string;
                            uses: number;
                        }[];
                    };
                };
            };
        };
    };
    TemplatesController_detail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                        channel: string;
                        /** @enum {string} */
                        category: "COLLECTION" | "BILLING";
                        date: string;
                        uses: number;
                        /** @enum {string} */
                        kind: "LETTER" | "EMAIL" | "SMS" | "INVOICE" | "CONTRACT";
                        registered: boolean;
                        quote: boolean;
                        version: number;
                        author: string;
                        usedBy: string;
                        subject: string | null;
                        body: string;
                        lines: {
                            label: string;
                            detail: string;
                            amount: string;
                        }[];
                        totals: string[];
                        fileName: string;
                        fileSize: string;
                        source: string;
                        block: string;
                        /** @enum {string} */
                        status: "PUBLISHED" | "IMPORTED" | "RESTORED" | "WAITING";
                        canImport: boolean;
                        canValidate: boolean;
                        validator: string;
                        pending: {
                            fileName: string;
                            accepted: boolean;
                            checks: {
                                /** @enum {string} */
                                level: "OK" | "WARNING" | "ERROR";
                                label: string;
                                detail: string;
                            }[];
                            previewHtml: string;
                        } | null;
                        versions: {
                            number: number;
                            what: string;
                            who: string;
                            /** @enum {string} */
                            state: "PUBLISHED" | "ARCHIVED";
                        }[];
                        samples: {
                            id: string;
                            label: string;
                            values: {
                                [key: string]: string;
                            };
                        }[];
                    };
                };
            };
        };
    };
    TemplatesController_import: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    TemplatesController_cancel: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    TemplatesController_undo: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    TemplatesController_restore: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    TemplatesController_submit: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    TemplatesController_review: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DebtorController_session: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        greeting: string;
                        debtor: string;
                        cases: {
                            id: string;
                            reference: string;
                            creditor: string;
                            balance: number;
                            statusLabel: string;
                            /** @enum {string} */
                            statusTone: "neutral" | "info" | "success" | "warning" | "danger" | "violet";
                        }[];
                    };
                };
            };
        };
    };
    DebtorController_access: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        greeting: string;
                        debtor: string;
                        cases: {
                            id: string;
                            reference: string;
                            creditor: string;
                            balance: number;
                            statusLabel: string;
                            /** @enum {string} */
                            statusTone: "neutral" | "info" | "success" | "warning" | "danger" | "violet";
                        }[];
                    };
                };
            };
        };
    };
    DebtorController_logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DebtorController_detail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        reference: string;
                        creditor: string;
                        balance: number;
                        statusLabel: string;
                        /** @enum {string} */
                        statusTone: "neutral" | "info" | "success" | "warning" | "danger" | "violet";
                        debtor: string;
                        officer: string;
                        isIndividual: boolean;
                        principal: number;
                        interest: number;
                        indemnity: number;
                        paid: number;
                        invoices: {
                            id: string;
                            number: string;
                            dueOn: string;
                            amount: number;
                        }[];
                        payments: {
                            id: string;
                            amount: number;
                            date: string;
                            /** @enum {string} */
                            method: "TRANSFER" | "CHEQUE";
                            receiptId: string | null;
                        }[];
                        next: {
                            date: string;
                            amount: number;
                        } | null;
                        lastMessage: {
                            who: string;
                            when: string;
                            text: string;
                        } | null;
                        unread: number;
                        plan: {
                            acceptedOn: string;
                            installments: {
                                number: number;
                                dueOn: string;
                                amount: number;
                                /** @enum {string} */
                                status: "PAID" | "DUE" | "UPCOMING" | "LATE";
                            }[];
                        } | null;
                        payment: {
                            beneficiary: string;
                            iban: string;
                            bic: string;
                            reference: string | null;
                            chequeOrder: string;
                            chequeAddress: string;
                        };
                    };
                };
            };
        };
    };
    DebtorController_link: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        identifier: {
                            /** @enum {string} */
                            kind: "SIREN" | "REFERENCE";
                            value: string;
                        };
                    };
                };
            };
        };
    };
    DebtorController_codeBySms: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        requested: true;
                    };
                };
            };
        };
    };
    DebtorController_limitedPayment: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        beneficiary: string;
                        iban: string;
                        bic: string;
                        reference: string | null;
                        chequeOrder: string;
                        chequeAddress: string;
                    };
                };
            };
        };
    };
    DebtorController_limitedMessage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DebtorController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            id: string;
                            mine: boolean;
                            who: string;
                            when: string;
                            text: string;
                            attachments: {
                                id: string;
                                name: string;
                            }[];
                            receipt: string | null;
                        }[];
                    };
                };
            };
        };
    };
    DebtorController_write: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DebtorController_read: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DebtorController_request: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DebtorController_attach: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                    };
                };
            };
        };
    };
    StaffPortalController_answer: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    PortalController_dashboard: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        kpis: {
                            label: string;
                            value: string;
                            hint: string;
                        }[];
                        statuses: {
                            /** @enum {string} */
                            status: "NEW" | "REMINDING" | "PLAN" | "LITIGATION" | "SETTLED" | "LOST";
                            count: number;
                        }[];
                        months: {
                            label: string;
                            amount: number;
                        }[];
                        activity: {
                            id: string;
                            who: string;
                            what: string;
                            when: string;
                            /** @enum {string} */
                            tone: "success" | "warning" | "danger" | "info";
                        }[];
                        approvals: {
                            id: string;
                            caseId: string;
                            debtor: string;
                            reference: string;
                            months: number;
                            installment: number;
                            total: number;
                            firstOn: string;
                            reason: string;
                            /** @enum {string} */
                            status: "PENDING" | "ACCEPTED" | "REFUSED";
                        }[];
                    };
                };
            };
        };
    };
    PortalController_cases: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            id: string;
                            /** @enum {string} */
                            status: "NEW" | "REMINDING" | "PLAN" | "LITIGATION" | "SETTLED" | "LOST";
                            debtor: string;
                            externalReference: string;
                            reference: string;
                            invoices: string;
                            entrusted: number;
                            recovered: number;
                            last: string;
                            steps: {
                                title: string;
                                date: string;
                            }[];
                        }[];
                        counts: {
                            [key: string]: number;
                        };
                    };
                };
            };
        };
    };
    PortalController_detail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        /** @enum {string} */
                        status: "NEW" | "REMINDING" | "PLAN" | "LITIGATION" | "SETTLED" | "LOST";
                        debtor: string;
                        externalReference: string;
                        reference: string;
                        invoices: string;
                        entrusted: number;
                        recovered: number;
                        last: string;
                        steps: {
                            title: string;
                            date: string;
                        }[];
                    };
                };
            };
        };
    };
    PortalController_decide: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    PortalController_deposit: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    PortalController_attach: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                    };
                };
            };
        };
    };
    PortalController_readImport: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        lines: number;
                        valid: number;
                        total: number;
                        errors: {
                            line: number;
                            message: string;
                        }[];
                    };
                };
            };
        };
    };
    PortalController_confirm: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        created: number;
                        pending: number;
                    };
                };
            };
        };
    };
    ShellController_shell: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        creditors: {
                            id: string;
                            name: string;
                            initials: string;
                            siren?: string;
                            count: number;
                        }[];
                        counts: {
                            teamOnline: number;
                            remindersToday: number;
                            litigationUrgent: number;
                            callQueue: number;
                            unreadEmails: number;
                            unreadSms: number;
                        };
                        notifications: {
                            id: string;
                            /** @enum {string} */
                            kind: "PAYMENT" | "MESSAGE" | "DEADLINE" | "CREDITOR" | "SYSTEM";
                            text: string;
                            meta: string;
                            href: string;
                            unread: boolean;
                        }[];
                    };
                };
            };
        };
    };
    ShellController_search: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        /** @enum {string} */
                        kind: "DEBTOR" | "CREDITOR" | "INVOICE";
                        title: string;
                        sub: string;
                        href: string;
                        initials: string;
                    }[];
                };
            };
        };
    };
}
