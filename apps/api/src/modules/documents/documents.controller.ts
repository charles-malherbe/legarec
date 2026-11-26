import { documentsData, importedDocument, REQUEST_BODIES } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, StreamableFile } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Staff } from '../../platform/access/access';
import { uploadedType } from '../../platform/http/context';
import { Commits } from '../../platform/http/transaction.interceptor';
import { DocumentsService } from './documents.service';

const bodies = REQUEST_BODIES.staff;
const WithCases = () => Staff('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER');

@ApiTags('documents')
@Controller('staff/documents')
export class DocumentsController {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  @Get()
  @WithCases()
  @ApiOkResponse({ standardSchema: documentsData })
  list() {
    return this.documents.list();
  }

  /** The body is the file, without its name (it never leaves the browser). */
  @Post('import')
  @WithCases()
  @Commits()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: importedDocument })
  import(@Body({ schema: bodies['POST /documents/import'] }) bytes: Uint8Array) {
    return this.documents.import(bytes, uploadedType());
  }

  @Post(':id/share')
  @WithCases()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  share(@Param('id') id: string) {
    return this.documents.share(id);
  }

  @Get(':id/file')
  @WithCases()
  @ApiOkResponse({ description: 'Le fichier, sous un nom neutre.' })
  async file(@Param('id') id: string) {
    const { bytes, type, name } = await this.documents.file(id);
    return new StreamableFile(bytes, { type, disposition: `attachment; filename="${name}"`, length: bytes.byteLength });
  }
}
