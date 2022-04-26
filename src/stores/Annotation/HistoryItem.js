import { types } from "mobx-state-tree";
import { guidGenerator } from "../../utils/unique";
import { Annotation } from "./Annotation";

const HistoryTypes = types.enumeration([
  'import',
  'submit',
  'update',
  'accepted',
  'rejected',
  'fixed_and_accepted',
]);

export const HistoryItem = types.compose("HistoryItem", Annotation, types.model({
  /**
   * Optional comment
   */
  comment: types.optional(types.maybeNull(types.string), null),

  /**
   * Action associated with the history item
   */
  actionType: types.optional(types.maybeNull(HistoryTypes), null),
})).preProcessSnapshot(snapshot => {
  return {
    ...snapshot,
    pk: guidGenerator(),
    user: snapshot.created_by,
    createdDate: snapshot.created_at,
    actionType: snapshot.action ?? snapshot.action_type ?? snapshot.actionType,
    editable: false,
  };
});
