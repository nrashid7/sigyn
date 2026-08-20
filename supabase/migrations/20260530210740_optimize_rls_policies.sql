DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles
  FOR SELECT
  USING (id = (select auth.uid()) OR is_admin());

DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles
  FOR UPDATE
  USING (id = (select auth.uid()));

DROP POLICY IF EXISTS businesses_insert ON businesses;
CREATE POLICY businesses_insert ON businesses
  FOR INSERT
  WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS business_members_select ON business_members;
CREATE POLICY business_members_select ON business_members
  FOR SELECT
  USING (user_id = (select auth.uid()) OR is_business_member(business_id) OR is_admin());

DROP POLICY IF EXISTS business_members_insert ON business_members;
CREATE POLICY business_members_insert ON business_members
  FOR INSERT
  WITH CHECK (user_id = (select auth.uid()) OR is_admin());

DROP POLICY IF EXISTS agent_templates_admin ON agent_templates;
DROP POLICY IF EXISTS agent_templates_admin_insert ON agent_templates;
DROP POLICY IF EXISTS agent_templates_admin_update ON agent_templates;
DROP POLICY IF EXISTS agent_templates_admin_delete ON agent_templates;

CREATE POLICY agent_templates_admin_insert ON agent_templates
  FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY agent_templates_admin_update ON agent_templates
  FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY agent_templates_admin_delete ON agent_templates
  FOR DELETE
  USING (is_admin());
