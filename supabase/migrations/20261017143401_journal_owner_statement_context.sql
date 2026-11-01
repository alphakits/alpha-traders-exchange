-- Preserve journal ownership and grants while evaluating the transaction-local
-- account context once per statement instead of once per candidate row.
-- This migration changes no journal records, roles, grants, or storage settings.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$ declare t text; begin
  foreach t in array array['journal_trades','journal_reviews','journal_settings','journal_files','journal_file_cleanup'] loop
    execute format(
      'alter policy journal_owner on alpha_exchange.%I
       using (user_id = (select nullif(current_setting(''alpha_journal.user_id'', true), '''')))
       with check (user_id = (select nullif(current_setting(''alpha_journal.user_id'', true), '''')))',
      t
    );
  end loop;
end $$;
commit;
