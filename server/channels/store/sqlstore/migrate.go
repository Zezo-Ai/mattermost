// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package sqlstore

import (
	"context"
	"fmt"
	"io"
	"log"
	"path"
	"sort"
	"strconv"
	"sync"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/v8/channels/db"
	"github.com/mattermost/morph"
	"github.com/mattermost/morph/drivers"
	ps "github.com/mattermost/morph/drivers/postgres"
	"github.com/mattermost/morph/models"
	mbindata "github.com/mattermost/morph/sources/embedded"
)

type Migrator struct {
	engine *morph.Morph
	store  *SqlStore
}

func NewMigrator(settings model.SqlSettings, logger mlog.LoggerIFace, dryRun bool) (*Migrator, error) {
	ss := &SqlStore{
		rrCounter:   0,
		srCounter:   0,
		settings:    &settings,
		logger:      logger,
		quitMonitor: make(chan struct{}),
		wgMonitor:   &sync.WaitGroup{},
	}

	err := ss.initConnection()
	if err != nil {
		return nil, fmt.Errorf("error in initializing connection: %w", err)
	}

	ver, err := ss.GetDbVersion(true)
	if err != nil {
		return nil, fmt.Errorf("error while getting DB version: %w", err)
	}

	ok, err := ss.ensureMinimumDBVersion(ver)
	if !ok {
		return nil, fmt.Errorf("error while checking DB version: %w", err)
	}

	engine, err := ss.initMorph(dryRun, true)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize morph: %w", err)
	}

	return &Migrator{
		engine: engine,
		store:  ss,
	}, nil
}

func (m *Migrator) Close() error {
	if err := m.engine.Close(); err != nil {
		return fmt.Errorf("failed to close morph engine: %w", err)
	}

	m.store.Close()

	return nil
}

func (m *Migrator) GetFileName(plan *models.Plan) (string, error) {
	if len(plan.Migrations) == 0 {
		return "", fmt.Errorf("plan is empty")
	}

	to := plan.Migrations[len(plan.Migrations)-1].Version
	from, err := m.store.GetDBSchemaVersion()
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("migration_plan_%d_%d", from, to), nil
}

func (ss *SqlStore) initMorph(dryRun, enableLogging bool) (*morph.Morph, error) {
	assets := db.Assets()

	assetsList, err := assets.ReadDir(path.Join("migrations", ss.DriverName()))
	if err != nil {
		return nil, err
	}

	assetNamesForDriver := make([]string, len(assetsList))
	for i, entry := range assetsList {
		assetNamesForDriver[i] = entry.Name()
	}

	src, err := mbindata.WithInstance(&mbindata.AssetSource{
		Names: assetNamesForDriver,
		AssetFunc: func(name string) ([]byte, error) {
			return assets.ReadFile(path.Join("migrations", ss.DriverName(), name))
		},
	})
	if err != nil {
		return nil, err
	}

	var driver drivers.Driver
	switch ss.DriverName() {
	case model.DatabaseDriverPostgres:
		driver, err = ps.WithInstance(ss.GetMaster().DB.DB)
	default:
		err = fmt.Errorf("unsupported database type %s for migration", ss.DriverName())
	}
	if err != nil {
		return nil, err
	}

	var logWriter io.Writer
	if enableLogging {
		logWriter = &morphWriter{}
	} else {
		logWriter = io.Discard
	}

	opts := []morph.EngineOption{
		morph.WithLogger(log.New(logWriter, "", log.Lshortfile)),
		morph.WithLock("mm-lock-key"),
		morph.SetStatementTimeoutInSeconds(*ss.settings.MigrationsStatementTimeoutSeconds),
		morph.SetDryRun(dryRun),
	}

	engine, err := morph.New(context.Background(), driver, src, opts...)
	if err != nil {
		return nil, err
	}

	return engine, nil
}

func (ss *SqlStore) migrate(direction migrationDirection, dryRun, enableMorphLogging bool) error {
	engine, err := ss.initMorph(dryRun, enableMorphLogging)
	if err != nil {
		return err
	}
	defer engine.Close()

	switch direction {
	case migrationsDirectionDown:
		_, err = engine.ApplyDown(-1)
		return err
	default:
		return engine.ApplyAll()
	}
}

func (m *Migrator) GeneratePlan(shouldRecover bool) (*models.Plan, error) {
	diff, err := m.engine.Diff(models.Up)
	if err != nil {
		return nil, err
	}

	plan, err := m.engine.GeneratePlan(diff, shouldRecover)
	if err != nil {
		return nil, err
	}

	return plan, nil
}

// MigrateWithPlan migrates the database to the latest version using the provided plan.
func (m *Migrator) MigrateWithPlan(plan *models.Plan, dryRun bool) error {
	return m.engine.ApplyPlan(plan)
}

func (m *Migrator) DowngradeMigrations(dryRun bool, versions ...string) error {
	migrations, err := m.engine.Diff(models.Down)
	if err != nil {
		return err
	}

	migrationsToDowngrade := make([]*models.Migration, 0, len(versions))
	for _, version := range versions {
		for _, migration := range migrations {
			versionNumber, sErr := strconv.Atoi(version)
			if sErr != nil {
				return sErr
			}
			if migration.Version == uint32(versionNumber) {
				migrationsToDowngrade = append(migrationsToDowngrade, migration)
			}
		}
	}

	sort.Slice(migrationsToDowngrade, func(i, j int) bool {
		return migrationsToDowngrade[i].Version > migrationsToDowngrade[j].Version
	})

	if len(migrationsToDowngrade) != len(versions) {
		mlog.Warn("could not match give migration versions, going to downgrade only the migrations those are available.")
	}

	plan, err := m.engine.GeneratePlan(migrationsToDowngrade, false)
	if err != nil {
		return err
	}

	return m.engine.ApplyPlan(plan)
}
