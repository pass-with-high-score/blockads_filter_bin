// Package storage handles Cloudflare R2 (S3-compatible) object storage operations.
package storage

import (
	"bytes"
	"context"
	"fmt"
	"time"

	"blockads-filtering/internal/config"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// R2Client wraps the S3-compatible client for Cloudflare R2 operations.
type R2Client struct {
	client    *s3.Client
	bucket    string
	publicURL string // e.g. "https://pub-xyz.r2.dev"
}

// NewR2Client creates a new R2 client configured for Cloudflare R2.
// Cloudflare R2 endpoint format: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
func NewR2Client(cfg *config.Config) (*R2Client, error) {
	r2Endpoint := fmt.Sprintf("https://%s.r2.cloudflarestorage.com", cfg.R2AccountID)

	r2Resolver := aws.EndpointResolverWithOptionsFunc(
		func(service, region string, options ...interface{}) (aws.Endpoint, error) {
			return aws.Endpoint{
				URL: r2Endpoint,
			}, nil
		},
	)

	awsCfg, err := awsconfig.LoadDefaultConfig(context.Background(),
		awsconfig.WithEndpointResolverWithOptions(r2Resolver),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(
				cfg.R2AccessKeyID,
				cfg.R2SecretAccessKey,
				"", // session token (not used for R2)
			),
		),
		awsconfig.WithRegion("auto"), // R2 uses "auto" region
	)
	if err != nil {
		return nil, fmt.Errorf("loading AWS config for R2: %w", err)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = true // R2 requires path-style access
	})

	return &R2Client{
		client:    client,
		bucket:    cfg.R2BucketName,
		publicURL: cfg.R2PublicURL,
	}, nil
}

// UploadZip uploads a zip byte buffer to R2 and returns the public download URL.
// The object key is: <name>.zip
func (r *R2Client) UploadZip(ctx context.Context, name string, data []byte) (string, error) {
	key := name + ".zip"

	ctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()

	_, err := r.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(r.bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String("application/zip"),
	})
	if err != nil {
		return "", fmt.Errorf("uploading %s to R2: %w", key, err)
	}

	downloadURL := fmt.Sprintf("%s/%s", r.publicURL, key)
	return downloadURL, nil
}

// DeleteObject removes an object from R2 by key.
func (r *R2Client) DeleteObject(ctx context.Context, name string) error {
	key := name + ".zip"

	_, err := r.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("deleting %s from R2: %w", key, err)
	}
	return nil
}
