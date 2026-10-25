-- APPR-04/SLA: dedupe and reminder queries filter by type+link per variant.
CREATE INDEX notifications_type_link_idx ON notifications USING btree ("type","link");
