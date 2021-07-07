import FQLDialog              from '../FQLDialog.js';
import QuestDB                from '../../control/QuestDB.js';
import Socket                 from '../../control/Socket.js';
import Utils                  from '../../control/Utils.js';
import ViewManager            from '../../control/ViewManager.js';

import HandlerAny             from './HandlerAny.js';
import HandlerDetails         from './HandlerDetails.js';
import HandlerManage          from './HandlerManage.js';

import { constants, settings }  from '../../model/constants.js';

export default class QuestPreview extends FormApplication
{
   /**
    * Since Quest Preview shows data for single Quest, it needs a Quest instance or
    * there is no point in rendering it.
    *
    * @param {Quest}   quest
    *
    * @param {object}   options
    */
   constructor(quest, options = {})
   {
      super(void 0, options);

      this.quest = quest;

      this.options.title = game.i18n.format('ForienQuestLog.QuestPreview.Title', this.quest);

      /**
       * Store the input focus callback in the associated QuestPreview instance so that it can be invoked if the app is
       * closed in {@link QuestPreview.close} while the input field is focused / being edited allowing any edits to be
       * saved. Otherwise the callback is invoked normally below as part of the input focus out event. Please see the
       * associated jQuery callback methods in {@link HandlerDetails} linked below.
       *
       * @param {Event|void}  event - HTML5 / jQuery event.
       *
       * @param {object}      [saveOptions] - Options to pass to `saveQuest`; used in {@link QuestPreview.close}.
       *
       * @returns {Promise<void>}
       *
       * @type {Function}
       * @protected
       * @see HandlerDetails.questEditName
       * @see HandlerDetails.questGiverCustomEditName
       * @see HandlerDetails.rewardAbstractEditName
       * @see HandlerDetails.taskEditName
       */
      this._activeFocusOutFunction = void 0;

      /**
       * Tracks any open FQLPermissionControl dialog that can be opened from the management tab, so that it can be
       * closed if this QuestPreview is closed.
       *
       * @type {FQLPermissionControl}
       * @protected
       * @see HandlerManage.configurePermissions
       * @see QuestPreview.close
       */
      this._permControl = void 0;

      /**
       * Stores a single instance of the ImagePopup for the splash image opened in
       * {@link HandlerDetails.splashImagePopupShow} preventing multiple copies of the splash image from being opened
       * at the same time. If open this ImagePopup is also closed when this QuestPreview closes in
       * {@link QuestPreview.close}.
       *
       * @type {ImagePopout}
       * @see {@link https://foundryvtt.com/api/ImagePopout.html}
       * @protected
       */
      this._splashImagePopup = void 0;
   }

   /**
    * Default Application options
    *
    * @returns {Object}
    */
   static get defaultOptions()
   {
      return mergeObject(super.defaultOptions, {
         classes: ['forien-quest-preview'],
         template: 'modules/forien-quest-log/templates/quest-preview.html',
         width: 700,
         height: 540,
         minimizable: false,
         resizable: true,
         submitOnChange: false,
         submitOnClose: false,
         title: game.i18n.localize('ForienQuestLog.QuestPreview.Title'),
         tabs: [{ navSelector: '.quest-tabs', contentSelector: '.quest-body', initial: 'details' }]
      });
   }

   /** @override */
   get id()
   {
      return `quest-${this.quest.id}`;
   }

   get object()
   {
      return this.quest;
   }

   set object(value) {}

   /** @override */
   _getHeaderButtons()
   {
      const buttons = super._getHeaderButtons();

      // Share Entry
      if (game.user.isGM)
      {
         buttons.unshift({
            label: game.i18n.localize('ForienQuestLog.QuestPreview.HeaderButtons.Show'),
            class: 'share-quest',
            icon: 'fas fa-eye',
            onclick: () => Socket.showQuestPreview(this.quest.id)
         });
      }

      if (this.quest.splash.length)
      {
         buttons.unshift({
            label: '',
            class: 'splash-image',
            icon: 'far fa-image',
            onclick: () =>
            {
               (new ImagePopout(this.quest.splash, { shareable: true })).render(true);
            }
         });
      }

      buttons.unshift({
         label: '',
         class: 'copy-link',
         icon: 'fas fa-link',
         onclick: () =>
         {
            const el = document.createElement('textarea');
            el.value = `@Quest[${this.quest.id}]{${this.quest.name}}`;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            ui.notifications.info(game.i18n.localize('ForienQuestLog.Notifications.LinkCopied'), {});
         }
      });

      return buttons;
   }

   /**
    * Close any tracked permission control app / dialog when tabs change.
    *
    * @private
    * @inheritDoc
    */
   _onChangeTab(event, tabs, active)
   {
      if (this._permControl)
      {
         this._permControl.close();
         this._permControl = void 0;
      }

      super._onChangeTab(event, tabs, active);
   }

   /**
    * This might be a FormApplication, but we don't want Submit event to fire.
    *
    * @private
    * @inheritDoc
    */
   async _onSubmit(event)
   {
      event.preventDefault();
      return false;
   }

   /**
    * This method is called upon form submission after form data is validated.
    *
    * @override
    * @private
    * @inheritDoc
    */
   async _updateObject(event, formData) // eslint-disable-line no-unused-vars
   {
      event.preventDefault();
   }

   /**
    * Provide TinyMCE overrides.
    *
    * @override
    */
   activateEditor(name, options = {}, initialContent = '')
   {
      super.activateEditor(name, Object.assign({}, options, Utils.tinyMCEOptions()), initialContent);
   }

   /**
    * Defines all event listeners like click, drag, drop etc.
    *
    * @param html
    */
   activateListeners(html)
   {
      super.activateListeners(html);

      html.on('click', '.quest-giver-name .open-actor-sheet', async (event) =>
       await HandlerDetails.questGiverShowActorSheet(event));

      // This CSS selector responds to any subquest attached to the details section or subquests listed in objectives.
      html.on('click', '.quest-name-link', (event) => HandlerAny.questOpen(event));

      html.on('dragstart', '.item-reward .editable-container', async (event) =>
       await HandlerDetails.rewardDragStartItem(event, this.quest));

      html.on('dragstart', '.quest-rewards .fa-sort', (event) => HandlerDetails.rewardDragStartSort(event));

      html.on('click', '.item-reward .editable-container', async (event) =>
       await HandlerDetails.rewardShowItemSheet(event, this.quest, this));

      html.on('click', '.splash-image-link', () => HandlerDetails.splashImagePopupShow(this.quest, this));

      html.on('dragstart', '.quest-tasks .fa-sort', (event) => HandlerDetails.taskDragStartSort(event));

      if (this.canEdit || this.playerEdit)
      {
         html.on('click', '.actions-single.quest-name .editable', (event) =>
          HandlerDetails.questEditName(event, this.quest, this));

         html.on('drop', '.quest-giver-gc', async (event) =>
          await HandlerDetails.questGiverDropDocument(event, this.quest, this));

         html.on('click', '.quest-giver-gc .toggleImage', async () =>
          await HandlerDetails.questGiverToggleImage(this.quest, this));

         html.on('click', '.quest-giver-gc .deleteQuestGiver', async () =>
          await HandlerDetails.questGiverDelete(this.quest, this));

         html.on('click', '.quest-tasks .add-new-task', (event) => HandlerDetails.taskAdd(event, this.quest, this));

         html.on('click', '.actions.tasks .delete', async (event) =>
          await HandlerDetails.taskDelete(event, this.quest, this));

         html.on('drop', '.tasks-box', async (event) => await HandlerDetails.taskDropItem(event, this.quest));

         html.on('click', '.actions.tasks .editable', (event) => HandlerDetails.taskEditName(event, this.quest, this));

         html.on('click', 'li.task .toggleState', async (event) =>
          await HandlerDetails.taskToggleState(event, this.quest, this));
      }

      if (this.canEdit || this.canAccept)
      {
         html.on('click', '.actions.quest-status i.delete', async (event) =>
          await HandlerAny.questDelete(event, this.quest));

         html.on('click', '.actions.quest-status i.move', async (event) =>
          await HandlerAny.questStatusSet(event));
      }

      if (this.canEdit)
      {
         html.on('click', '.quest-giver-name .actions-single .editable', (event) =>
          HandlerDetails.questGiverCustomEditName(event, this.quest, this));

         html.on('click', '.quest-giver-gc .drop-info', () =>
          HandlerDetails.questGiverCustomSelectImage(this.quest, this));

         html.on('click', '.quest-rewards .add-abstract', (event) =>
          HandlerDetails.rewardAddAbstract(event, this.quest, this));

         html.on('click', '.actions.rewards .editable', (event) =>
          HandlerDetails.rewardAbstractEditName(event, this.quest, this));

         html.on('click', '.actions.rewards .delete', async (event) =>
          await HandlerDetails.rewardDelete(event, this.quest, this));

         html.on('drop', '.rewards-box', async (event) => await HandlerDetails.rewardDropItem(event, this.quest, this));

         html.on('click', '.abstract-reward .reward-image', async (event) =>
          await HandlerDetails.rewardSelectAbstractImage(event, this.quest, this));

         html.on('click', '.show-all-rewards', async () => await HandlerDetails.rewardsShowAll(this.quest, this));

         html.on('click', '.actions.rewards .toggleHidden', async (event) =>
          await HandlerDetails.rewardToggleHidden(event, this.quest, this));

         html.on('click', '.actions.rewards .toggleLocked', async (event) =>
          await HandlerDetails.rewardToggleLocked(event, this.quest, this));

         html.on('click', '.quest-rewards .unlock-all-rewards', async () =>
          await HandlerDetails.rewardsUnlockAll(this.quest, this));

         html.on('click', '.actions.tasks .toggleHidden', async (event) =>
          await HandlerDetails.taskToggleHidden(event, this.quest, this));

         // Management view callbacks -------------------------------------------------------------------------------

         html.on('click', '.add-subquest-btn', async () => await HandlerManage.addSubquest(this.quest, this));

         html.on('click', '.configure-perm-btn', () => HandlerManage.configurePermissions(this.quest, this));

         html.on('click', '.delete-splash', async () => await HandlerManage.deleteSplashImage(this.quest, this));

         html.on('click', `.quest-splash #splash-as-icon-${this.quest.id}`, async (event) =>
          await HandlerManage.setSplashAsIcon(event, this.quest, this));

         html.on('click', '.quest-splash .drop-info', async () => await HandlerManage.setSplashImage(this.quest, this));

         html.on('click', '.change-splash-pos', async () => await HandlerManage.setSplashPos(this.quest, this));
      }
   }

   /**
    * When closing this Foundry app:
    * - Remove reference from {@link ViewManager.questPreview}
    * - Close any associated dialogs via {@link FQLDialog.closeDialogs}
    * - Close any associated {@link QuestPreview._permControl}
    * - Close any associated {@link QuestPreview._splashImagePopup}
    * - If set invoke {@link QuestPreview._activeFocusOutFunction} or {@link QuestPreview.saveQuest} if the current
    * user is the owner of the quest and options `noSave` is false.
    *
    * Save the quest on close with no refresh of data.
    *
    * @param {object} options - Optional params
    *
    * @param {boolean} [options.noSave] - When true the quest is not saved on close otherwise save quest.
    *
    * @param {object} [options.options] - Options which are passed through to {@link FormApplication.close}
    *
    * @returns {Promise<void>}
    * @inheritDoc
    * @see FormApplication.close
    * @see https://foundryvtt.com/api/FormApplication.html#close
    */
   async close({ noSave = false, ...options } = {})
   {
      delete ViewManager.questPreview[this.quest.id];

      FQLDialog.closeDialogs({ questId: this.quest.id });

      // If a permission control app / dialog is open close it.
      if (this._permControl)
      {
         this._permControl.close();
         this._permControl = void 0;
      }

      // If a splash ImagePopup is open close it.
      if (this._splashImagePopup)
      {
         this._splashImagePopup.close();
         this._splashImagePopup = void 0;
      }

      // Only potentially save the quest if the user is the owner and noSave is false.
      if (!noSave && this.quest.isOwner)
      {
         // If there is an active input focus function set then invoke it so that the input field is saved.
         if (typeof this._activeFocusOutFunction === 'function')
         {
            await this._activeFocusOutFunction(void 0, { refresh: false });

            // Send a socket refresh event to all clients. This will also render all local apps as applicable.
            // Must update parent and any subquests / children.
            Socket.refreshQuestPreview({
               questId: this.quest.parent ? [this.quest.parent, this.quest.id, ...this.quest.subquests] :
                [this.quest.id, ...this.quest.subquests],
               focus: false,
            });
         }
         else
         {
            // Otherwise save the quest as normal.
            await this.saveQuest({ refresh: false });
         }
      }

      return super.close(options);
   }

   /**
    * Retrieves Data to be used in rendering template.
    *
    * @override
    * @inheritDoc
    */
   async getData(options = {}) // eslint-disable-line no-unused-vars
   {
      // const content = await Enrich.quest(this.quest);
      const content = QuestDB.getEnrich(this.quest.id);

      this.canEdit = game.user.isGM || (this.quest.isOwner && Utils.isTrustedPlayerEdit());
      this.playerEdit = this.quest.isOwner;
      this.canAccept = game.settings.get(constants.moduleName, settings.allowPlayersAccept);

      // By default all normal players and trusted players without ownership of a quest are always on the the default
      // tab 'details'. In the case of a trusted player who has permissions revoked to access the quest and is on the
      // 'management' the details tab needs to be activated. This is possible in 'getData' as it is fairly early in the
      // render process. At this time the internal state of the application is '1' for 'RENDERING'.
      if (!this.canEdit && this._tabs[0] && this._tabs[0].active !== 'details')
      {
         this._tabs[0].activate('details');
      }

      const data = {
         isGM: game.user.isGM,
         isPlayer: !game.user.isGM,
         canAccept: this.canAccept,
         canEdit: this.canEdit,
         playerEdit: this.playerEdit
      };

      return mergeObject(content, data);
   }

   /**
    * Refreshes the Quest Details window and emits Socket so other players get updated view as well
    *
    * @returns {Promise<void>}
    */
   async refresh()
   {
      Socket.refreshQuestPreview({
         questId: this.quest.parent ? [this.quest.parent, this.quest.id, ...this.quest.subquests] :
          [this.quest.id, ...this.quest.subquests],
         focus: false,
      });

      this.render(true, { focus: true });
   }

   /**
    * When rendering window, add reference to global variable.
    *
    * @see close()
    * @inheritDoc
    * @override
    */
   async render(force = false, options = { focus: true })
   {
      ViewManager.questPreview[this.quest.id] = this;

      return super.render(force, options);
   }

   /**
    * When editor is saved we simply save the quest. The editor content if any is available is saved inside 'saveQuest'.
    *
    * @override
    * @inheritDoc
    */
   async saveEditor()
   {
      return this.saveQuest();
   }

   /**
    * Save associated quest and refresh window
    *
    * @param {object} options - Optional parameters
    *
    * @param {boolean} options.refresh - Execute `QuestPreview.refresh`
    *
    * @returns {Promise<void>}
    */
   async saveQuest({ refresh = true } = {})
   {
      for (const key of Object.keys(this.editors))
      {
         const editor = this.editors[key];

         if (editor.mce)
         {
            this.quest[key] = editor.mce.getContent();
            await super.saveEditor(key);
         }
      }

      await this.quest.save();

      return refresh ? this.refresh() : void 0;
   }
}
