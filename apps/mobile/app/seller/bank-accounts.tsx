import { useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Redirect } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import {
  createMobileSellerBankAccount,
  deleteMobileSellerBankAccount,
  getMobileSellerBankAccounts,
} from "../../src/api/mobile-api";
import { useAuth } from "../../src/auth/auth-context";
import { GoldButton } from "../../src/components/gold-button";
import { NativePageShell } from "../../src/components/native-page-shell";
import { useLocale } from "../../src/i18n/locale-context";

const BANKS = [
  ["Bank Leumi", "بنك لئومي"],
  ["Bank Hapoalim", "بنك هبوعليم"],
  ["Mizrahi-Tefahot", "بنك مزراحي طفحوت"],
  ["Discount", "بنك ديسكونت"],
  ["First International", "البنك الدولي الأول"],
  ["Yahav", "بنك ياهف"],
  ["Mercantile", "بنك مركنتيل"],
  ["Massad", "بنك مساد"],
  ["Jerusalem", "بنك القدس"],
  ["ONE ZERO", "بنك ONE ZERO"],
] as const;

export default function SellerBankAccountsScreen() {
  const queryClient = useQueryClient();
  const { status, user, requestWithSession } = useAuth();
  const { locale, isRTL } = useLocale();
  const isAr = locale === "ar";
  const canSell = user?.sellerStatus === "approved_seller"
    || user?.roles.some((role) => role === "approved_seller" || role === "admin" || role === "owner") === true;
  const queryKey = ["mobile-seller-bank-accounts", user?.id ?? "anonymous", locale] as const;
  const [showForm, setShowForm] = useState(false);
  const [holder, setHolder] = useState(user?.fullName ?? "");
  const [bankName, setBankName] = useState("");
  const [branchNumber, setBranchNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState("");

  const query = useQuery({
    enabled: status === "authenticated" && canSell,
    queryKey,
    queryFn: ({ signal }) => requestWithSession((tokens, requestLocale) =>
      getMobileSellerBankAccounts(tokens, requestLocale, signal)),
  });
  const createMutation = useMutation({
    mutationFn: () => requestWithSession((tokens, requestLocale) => createMobileSellerBankAccount(tokens, requestLocale, {
      accountHolderName: holder.trim(),
      bankName,
      branchNumber: branchNumber.trim(),
      accountNumber: accountNumber.trim(),
      isDefault,
    })),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKey, response);
      setShowForm(false);
      setBankName("");
      setBranchNumber("");
      setAccountNumber("");
      setIsDefault(false);
      setError("");
    },
    onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : (isAr ? "تعذر حفظ الحساب." : "The account could not be saved.")),
  });
  const deleteMutation = useMutation({
    mutationFn: (bankAccountId: string) => requestWithSession((tokens, requestLocale) =>
      deleteMobileSellerBankAccount(tokens, requestLocale, bankAccountId)),
    onSuccess: (response) => queryClient.setQueryData(queryKey, response),
    onError: (mutationError) => Alert.alert(isAr ? "تعذر الحذف" : "Unable to delete", mutationError instanceof Error ? mutationError.message : (isAr ? "الحساب مرتبط بعرض أو صفقة نشطة." : "The account may be linked to an active listing or trade.")),
  });

  if (status !== "authenticated" || !user) return <Redirect href="/(public)/login" />;
  if (!canSell) return <Redirect href="/seller-application" />;

  function save() {
    if (holder.trim().length < 2 || !bankName || !branchNumber.trim() || !accountNumber.trim()) {
      setError(isAr ? "أكمل جميع بيانات الحساب البنكي." : "Complete every bank-account field.");
      return;
    }
    setError("");
    createMutation.mutate();
  }

  function requestDelete(id: string) {
    Alert.alert(
      isAr ? "حذف الحساب البنكي؟" : "Delete bank account?",
      isAr ? "لن يتم الحذف إذا كان الحساب مرتبطًا بعرض أو صفقة نشطة." : "It cannot be deleted while linked to an active listing or trade.",
      [
        { text: isAr ? "إلغاء" : "Cancel", style: "cancel" },
        { text: isAr ? "حذف" : "Delete", style: "destructive", onPress: () => deleteMutation.mutate(id) },
      ],
    );
  }

  return (
    <NativePageShell
      authenticated
      title={isAr ? "الحسابات البنكية" : "Bank accounts"}
      subtitle={isAr ? "تظل أرقام الحساب الكاملة مخفية حتى تبدأ الصفقة." : "Full account numbers remain hidden until a trade starts."}
    >
      <View style={styles.securityCard}>
        <Text style={[styles.securityTitle, isRTL && styles.rtlText]}>◆ {isAr ? "بيانات دفع خاصة" : "Private payout data"}</Text>
        <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "لن نعرض رقم الحساب الكامل في السوق أو ملف البائع العام." : "The full number is never shown in the marketplace or public seller profile."}</Text>
      </View>
      <View style={styles.list}>
        {query.data?.bankAccounts.length ? query.data.bankAccounts.map((account) => (
          <View key={account.id} style={styles.accountCard}>
            <View style={[styles.accountTop, isRTL && styles.rowReverse]}>
              <View style={styles.accountCopy}>
                <Text style={[styles.accountBank, isRTL && styles.rtlText]}>{account.bankName}</Text>
                <Text style={[styles.body, isRTL && styles.rtlText]}>{account.accountHolderName}</Text>
              </View>
              {account.isDefault ? <Text style={styles.defaultBadge}>{isAr ? "افتراضي" : "Default"}</Text> : null}
            </View>
            <Text selectable style={[styles.accountNumber, isRTL && styles.rtlText]}>{account.maskedAccountNumber}</Text>
            <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "الفرع" : "Branch"}: {account.branchNumber}</Text>
            <GoldButton disabled={deleteMutation.isPending} onPress={() => requestDelete(account.id)} variant="outline">{isAr ? "حذف" : "Delete"}</GoldButton>
          </View>
        )) : (
          <View style={styles.empty}><Text style={[styles.body, isRTL && styles.rtlText]}>{query.isLoading ? (isAr ? "جارٍ التحميل..." : "Loading...") : (isAr ? "لا توجد حسابات بنكية محفوظة." : "No bank accounts saved yet.")}</Text></View>
        )}
      </View>
      {!showForm ? (
        <GoldButton onPress={() => setShowForm(true)}>{isAr ? "إضافة حساب بنكي" : "Add bank account"}</GoldButton>
      ) : (
        <View style={styles.form}>
          <Text accessibilityRole="header" style={[styles.formTitle, isRTL && styles.rtlText]}>{isAr ? "حساب بنكي جديد" : "New bank account"}</Text>
          <Field label={isAr ? "اسم صاحب الحساب" : "Account holder name"} value={holder} onChangeText={setHolder} isRTL={isRTL} />
          <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "البنك" : "Bank"}</Text>
          <View style={styles.bankList}>
            {BANKS.map(([english, arabic]) => (
              <Pressable key={english} onPress={() => setBankName(english)} style={[styles.bankOption, bankName === english && styles.bankOptionSelected]}>
                <Text style={[styles.bankOptionText, bankName === english && styles.bankOptionTextSelected]}>{bankName === english ? "✓ " : ""}{isAr ? arabic : english}</Text>
              </Pressable>
            ))}
          </View>
          <Field keyboardType="number-pad" label={isAr ? "رقم الفرع" : "Branch number"} value={branchNumber} onChangeText={setBranchNumber} isRTL={isRTL} />
          <Field keyboardType="number-pad" label={isAr ? "رقم الحساب" : "Account number"} value={accountNumber} onChangeText={setAccountNumber} isRTL={isRTL} secureTextEntry />
          <View style={[styles.switchRow, isRTL && styles.rowReverse]}>
            <View style={styles.accountCopy}>
              <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "تعيين كافتراضي" : "Set as default"}</Text>
              <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "يُستخدم تلقائيًا للعروض الجديدة." : "Automatically selected for new listings."}</Text>
            </View>
            <Switch onValueChange={setIsDefault} value={isDefault} trackColor={{ false: colors.border, true: colors.goldMuted }} thumbColor={isDefault ? colors.goldBright : colors.textMuted} />
          </View>
          {error ? <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>{error}</Text> : null}
          <GoldButton loading={createMutation.isPending} onPress={save}>{isAr ? "حفظ الحساب" : "Save account"}</GoldButton>
          <GoldButton disabled={createMutation.isPending} onPress={() => setShowForm(false)} variant="ghost">{isAr ? "إلغاء" : "Cancel"}</GoldButton>
        </View>
      )}
    </NativePageShell>
  );
}

function Field({ label, value, onChangeText, isRTL, keyboardType = "default", secureTextEntry = false }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  isRTL: boolean;
  keyboardType?: "default" | "number-pad";
  secureTextEntry?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, isRTL && styles.rtlText]}>{label}</Text>
      <TextInput autoCapitalize="words" keyboardType={keyboardType} onChangeText={onChangeText} placeholder={label} placeholderTextColor={colors.textMuted} secureTextEntry={secureTextEntry} selectionColor={colors.gold} style={[styles.input, isRTL && styles.rtlInput]} value={value} />
    </View>
  );
}

const styles = StyleSheet.create({
  securityCard: { backgroundColor: "rgba(41,121,255,0.08)", borderColor: "#6CAEFF", borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.lg },
  securityTitle: { color: "#93C5FD", fontSize: typography.section, fontWeight: "900" },
  body: { color: colors.textMuted, fontSize: typography.small, lineHeight: 21 },
  list: { gap: spacing.md },
  accountCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.lg },
  accountTop: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  accountCopy: { flex: 1, gap: spacing.xs },
  accountBank: { color: colors.text, fontSize: typography.section, fontWeight: "900" },
  accountNumber: { color: colors.goldBright, fontSize: typography.body, fontWeight: "800" },
  defaultBadge: { backgroundColor: "rgba(216,180,74,0.10)", borderColor: colors.borderGold, borderRadius: radius.pill, borderWidth: 1, color: colors.goldBright, fontSize: typography.caption, fontWeight: "900", overflow: "hidden", paddingHorizontal: spacing.sm, paddingVertical: 5 },
  empty: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg },
  form: { backgroundColor: colors.surface, borderColor: colors.borderGold, borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  formTitle: { color: colors.text, fontSize: typography.section, fontWeight: "900" },
  field: { gap: spacing.sm },
  label: { color: colors.text, fontSize: typography.small, fontWeight: "800" },
  input: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.text, fontSize: typography.body, minHeight: 50, paddingHorizontal: spacing.md },
  bankList: { gap: spacing.sm },
  bankOption: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md },
  bankOptionSelected: { backgroundColor: "rgba(41,121,255,0.13)", borderColor: "#6CAEFF" },
  bankOptionText: { color: colors.textMuted, fontSize: typography.small, fontWeight: "700" },
  bankOptionTextSelected: { color: colors.text },
  switchRow: { alignItems: "center", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  error: { color: colors.danger, fontSize: typography.small, fontWeight: "700", lineHeight: 20 },
  rowReverse: { flexDirection: "row-reverse" },
  rtlInput: { textAlign: "right", writingDirection: "rtl" },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
});
